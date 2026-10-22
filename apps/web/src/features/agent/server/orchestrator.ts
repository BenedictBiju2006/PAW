import { createHash } from "node:crypto";
import {
  tool,
  type ModelMessage,
  type ToolSet,
  type AssistantContent,
} from "ai";
import { z } from "zod";
import type { ModelProvider } from "../../providers/model/provider";
import { providerError } from "../../providers/model/provider";
import type { AgentStore, TurnStatus } from "./store";
import type { ExecutionTools } from "../../tooling/contract";
import type { AgentEvent } from "./events";
import { redact } from "./events";
import { bootstrapPrompt } from "./prompts";
export function agentLimits(env: NodeJS.ProcessEnv = process.env) {
  const n = (key: string, value: number, max: number) =>
    Math.min(max, Math.max(1, Number(env[key]) || value));
  return {
    steps: n("PAW_AGENT_MAX_STEPS", 24, 40),
    calls: n("PAW_AGENT_MAX_TOOL_CALLS", 50, 100),
    durationMs: n("PAW_AGENT_TIMEOUT_MS", 120000, 300000),
    outputTokens: n("PAW_AGENT_MAX_OUTPUT_TOKENS", 8000, 20000),
    resultChars: n("PAW_AGENT_MAX_RESULT_CHARS", 30000, 60000),
    contextChars: n("PAW_AGENT_MAX_CONTEXT_CHARS", 160000, 300000),
  };
}
type Store = Pick<AgentStore, "event" | "finish"> &
  Partial<Pick<AgentStore, "diagnostics">>;
const bootstrap = [
  "search_tools",
  "describe_tool",
  "list_resources",
  "inspect_resource",
];
const dispatch = z
  .object({
    toolId: z.string().max(100),
    arguments: z.record(z.string(), z.json()),
  })
  .strict();
export class AgentOrchestrator {
  constructor(
    private provider: ModelProvider,
    private executor: ExecutionTools,
    private store: Store,
    private limits = agentLimits(),
  ) {}
  async run(
    input: {
      turnId: string;
      workspaceId: string;
      conversationId: string;
      model: string;
      apiKey: string;
      history: ModelMessage[];
      signal: AbortSignal;
    },
    emit: (event: AgentEvent) => void,
  ) {
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(this.limits.durationMs),
    ]);
    const messages = [...input.history],
      described = new Set<string>(),
      repetitions = new Map<string, number>(),
      completedMutations = new Map<string, unknown>();
    const tools: ToolSet = {};
    for (const id of bootstrap) {
      const definition = this.executor.registry.resolve(id)!;
      tools[id] = tool({
        description: definition.description,
        inputSchema: definition.inputSchema,
      });
    }
    tools.invoke_tool = tool({
      description:
        "Invoke a discovered capability after describe_tool has returned its schema in this turn. Permissions and confirmation remain enforced by PAW.",
      inputSchema: dispatch,
    });
    let requestingModel = false;
    let requests = 0,
      cached: number | null = null;
    let calls = 0,
      tokensIn = 0,
      tokensOut = 0,
      charsOut = 0,
      status: Exclude<TurnStatus, "running" | "interrupted"> = "completed",
      notice: string | null = null,
      step = 0;
    let fragment = "",
      fragmentId = "",
      textIndex = 0;
    const flush = async () => {
      while (fragment) {
        const chunk = fragment.slice(0, 15000);
        await this.store.event(input.turnId, `text:${textIndex}`, "assistant", [
          { type: "text", text: chunk },
        ]);
        textIndex++;
        fragment = fragment.slice(chunk.length);
      }
    };
    const fail = (code: string, message: string) => ({
      ok: false,
      error: {
        code,
        message,
        guidance:
          "Inspect the tool schema or current resource before retrying.",
      },
    });
    try {
      for (; step < this.limits.steps; step++) {
        signal.throwIfAborted();
        if (JSON.stringify(messages).length > this.limits.contextChars)
          throw new LimitError(
            "The context limit was reached. Completed changes are saved. Start a new request to continue.",
          );
        const pending: Extract<
          import("../../providers/model/provider").ProviderEvent,
          { type: "call" }
        >[] = [];
        let stepText = "",
          finishReason = "stop";
        fragmentId = `text-${step}`;
        requests++;
        requestingModel = true;
        for await (const event of this.provider.stream({
          model: input.model,
          apiKey: input.apiKey,
          system: bootstrapPrompt(input.workspaceId, input.conversationId),
          messages,
          tools,
          signal,
          maxOutputTokens: Math.max(1, this.limits.outputTokens - tokensOut),
        })) {
          signal.throwIfAborted();
          if (event.type === "text") {
            charsOut += event.text.length;
            if (charsOut > 50000)
              throw new LimitError(
                "The response size limit was reached. Completed work is saved.",
              );
            fragment += event.text;
            stepText += event.text;
            emit({ type: "text", id: fragmentId, text: event.text });
            if (fragment.length >= 12000) await flush();
          } else if (event.type === "call") {
            pending.push(event);
            if (pending.length + calls > this.limits.calls)
              throw new LimitError(
                "The tool-call limit was reached. Completed operations are saved.",
              );
          } else {
            if (event.cachedInput !== undefined)
              cached = (cached ?? 0) + event.cachedInput;
            tokensIn += event.input;
            tokensOut += event.output;
            finishReason = event.reason;
          }
        }
        requestingModel = false;
        await flush();
        if (tokensOut >= this.limits.outputTokens || finishReason === "length")
          throw new LimitError(
            "The output-token limit was reached. Completed operations are saved; ask to continue if needed.",
          );
        if (!pending.length) break;
        const assistant: AssistantContent = [];
        if (stepText) assistant.push({ type: "text", text: stepText });
        for (const call of pending)
          assistant.push({
            type: "tool-call",
            toolCallId: call.id,
            toolName: call.name,
            input: call.args,
            providerOptions: call.providerOptions,
          });
        messages.push({ role: "assistant", content: assistant });
        for (const call of pending) {
          signal.throwIfAborted();
          calls++;
          const invocationId = `${input.turnId}:${calls}`;
          let toolId = call.name,
            args: Record<string, unknown> = {},
            result: unknown;
          if (call.name === "invoke_tool") {
            const parsed = dispatch.safeParse(call.args);
            if (!parsed.success)
              result = fail(
                "invalid_arguments",
                "invoke_tool requires a toolId and arguments object.",
              );
            else {
              toolId = parsed.data.toolId;
              args = parsed.data.arguments;
              if (!described.has(toolId))
                result = fail(
                  "schema_required",
                  "Call describe_tool for this capability before invoking it.",
                );
            }
          } else if (
            call.args &&
            typeof call.args === "object" &&
            !Array.isArray(call.args)
          )
            args = call.args as Record<string, unknown>;
          else
            result = fail("invalid_arguments", "Expected an arguments object.");
          if (JSON.stringify(args).length > 250000)
            result = fail(
              "input_too_large",
              "Tool arguments exceed 250,000 characters.",
            );
          let safeArgs = redact(args) as Record<string, unknown>;
          if (Buffer.byteLength(JSON.stringify(safeArgs)) > 60000) {
            safeArgs = {
              summary: "Arguments exceeded the journal size limit.",
            };
            result = fail(
              "input_too_large",
              "Reduce tool arguments to at most 60,000 characters.",
            );
          }
          // Persist the invocation before execution. A repeated turn never resumes
          // unfinished calls, avoiding replay after a disconnect or server crash.
          const fresh = await this.store.event(
            input.turnId,
            `call:${invocationId}`,
            "assistant",
            [
              {
                type: "tool_call",
                invocationId,
                toolId,
                arguments: safeArgs,
                status: "running",
              },
            ],
          );
          if (!fresh)
            throw new LimitError(
              "An invocation with this identity already exists. It will not be replayed.",
            );
          emit({
            type: "activity",
            activity: {
              invocationId,
              toolId,
              arguments: safeArgs,
              status: "running",
            },
          });
          const signature = createHash("sha256")
            .update(toolId + canonical(args))
            .digest("hex");
          const repeated = (repetitions.get(signature) ?? 0) + 1;
          repetitions.set(signature, repeated);
          const definition = this.executor.registry.resolve(toolId);
          if (!result && repeated > 3)
            result = fail(
              "repeated_operation",
              "This operation has repeated three times. Inspect a different resource or explain the blocker.",
            );
          if (!result && completedMutations.has(signature))
            result = completedMutations.get(signature);
          else if (!result) {
            result = await this.executor.execute(toolId, args);
            if (definition?.sideEffects === "write")
              completedMutations.set(signature, result);
          }
          const actual = result as { ok: boolean; error?: { code?: string } };
          if (
            actual.ok &&
            toolId === "describe_tool" &&
            typeof args.toolId === "string"
          )
            described.add(args.toolId);
          const serialized = JSON.stringify(redact(result));
          const safeResult =
            serialized.length > this.limits.resultChars ||
            Buffer.byteLength(serialized) > 60000
              ? fail(
                  "result_too_large",
                  "Result exceeded the response bound. Narrow the query, lower its limit, or inspect an individual resource/component.",
                )
              : JSON.parse(serialized);
          await this.store.event(
            input.turnId,
            `result:${invocationId}`,
            "tool",
            [
              {
                type: "tool_result",
                invocationId,
                toolId,
                result: safeResult,
                isError: !actual.ok,
              },
            ],
          );
          emit({
            type: "activity",
            activity: {
              invocationId,
              toolId,
              arguments: safeArgs,
              status: actual.ok
                ? "completed"
                : actual.error?.code === "confirmation_required"
                  ? "awaiting_confirmation"
                  : "failed",
              result: safeResult,
            },
          });
          if (actual.ok && definition?.sideEffects === "write")
            emit({ type: "mutation", workspaceId: input.workspaceId });
          messages.push({
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: call.id,
                toolName: call.name,
                output: { type: "json", value: safeResult },
              },
            ],
          });
        }
      }
      if (step === this.limits.steps)
        throw new LimitError(
          "The model-step limit was reached. Completed operations are saved. Ask a new question to continue.",
        );
    } catch (error) {
      status = signal.aborted
        ? "cancelled"
        : error instanceof LimitError
          ? "limited"
          : "failed";
      notice =
        error instanceof LimitError
          ? error.message
          : providerError(
              error,
              this.provider.id,
              requestingModel
                ? {
                    request: requests,
                    phase: requests === 1 ? "initial" : "after_tool_results",
                  }
                : undefined,
            );
    } finally {
      try {
        await flush();
        if (notice)
          await this.store.event(input.turnId, "notice", "assistant", [
            { type: "text", text: notice },
          ]);
      } catch {
        status = "failed";
        notice =
          "Transcript persistence was interrupted. Completed workspace operations may still be saved; inspect current state before issuing a new request.";
      } finally {
        await this.store.diagnostics?.(input.turnId, requests, calls, cached);
        await this.store.finish(
          input.turnId,
          status,
          tokensIn,
          tokensOut,
          notice,
        );
        emit({
          type: "turn",
          id: input.turnId,
          status,
          notice,
          usage: { input: tokensIn, output: tokensOut },
        });
      }
    }
  }
}
class LimitError extends Error {}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => JSON.stringify(key) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
