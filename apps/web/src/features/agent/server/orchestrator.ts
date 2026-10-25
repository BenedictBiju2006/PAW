import { type AssistantContent, type ModelMessage } from "ai";
import "server-only";
import type { ModelProvider } from "../../providers/public";
import { providerError } from "../../providers/public";
import type { ExecutionTools } from "../../tooling/public";
import type { ModelRequestDiagnostic } from "../model/diagnostics";
import { toolDefinitionCharacters } from "./diagnostics";
import type { AgentEvent } from "../model/events";
import { bootstrapTools } from "./bootstrap-tools";
import type { Store } from "./contracts";
import { agentLimits, LimitError } from "./limits";
import { bootstrapPrompt } from "./prompts";
import type { TurnStatus } from "./store";
import { TextJournal } from "./text-journal";
import { executionContext, type ToolExchange } from "./turn-context";
import { ToolSession } from "./tool-session";
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
    const exchanges: ToolExchange[] = [];
    const system = bootstrapPrompt(input.workspaceId, input.conversationId);
    const historyCharacters = JSON.stringify(input.history).length;
    const tools = bootstrapTools(this.executor);
    const session = new ToolSession(this.executor, this.store, this.limits);
    const journal = new TextJournal(this.store, input.turnId);
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
    let fragmentId = "";

    try {
      const toolsCharacters = await toolDefinitionCharacters(tools);
      for (; step < this.limits.steps; step++) {
        signal.throwIfAborted();
        const context = executionContext(
          input.history,
          exchanges,
          session.working,
          (id) => this.executor.registry.schemaVersion(id),
        );
        if (JSON.stringify(context.messages).length > this.limits.contextChars)
          throw new LimitError(
            "The context limit was reached. Completed changes are saved. Start a new request to continue.",
          );
        const pending: Extract<
          import("../../providers/public").ProviderEvent,
          { type: "call" }
        >[] = [];
        let stepText = "",
          finishReason = "stop";
        fragmentId = `text-${step}`;
        requests++;
        requestingModel = true;
        const diagnostic: ModelRequestDiagnostic = {
          request: requests,
          provider: this.provider.id,
          model: input.model,
          status: "incomplete",
          inputTokens: null,
          outputTokens: null,
          cachedInputTokens: null,
          cumulativeInputTokens: tokensIn,
          cumulativeOutputTokens: tokensOut,
          compaction: context.compaction,
          contextCharacters: {
            system: system.length,
            history: historyCharacters,
            tools: toolsCharacters,
            exchanges: context.compaction.rawExchangeCharacters,
          },
        };
        try {
          for await (const event of this.provider.stream({
            model: input.model,
            apiKey: input.apiKey,
            system,
            messages: context.messages,
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
              journal.append(event.text);
              stepText += event.text;
              emit({ type: "text", id: fragmentId, text: event.text });
              if (journal.size >= 12000) await journal.flush();
            } else if (event.type === "call") {
              pending.push(event);
              if (pending.length + calls > this.limits.calls)
                throw new LimitError(
                  "The tool-call limit was reached. Completed operations are saved.",
                );
            } else {
              if (event.cachedInput !== undefined)
                cached = (cached ?? 0) + event.cachedInput;
              if (event.input !== undefined) {
                diagnostic.inputTokens =
                  (diagnostic.inputTokens ?? 0) + event.input;
                tokensIn += event.input;
              }
              if (event.output !== undefined) {
                diagnostic.outputTokens =
                  (diagnostic.outputTokens ?? 0) + event.output;
                tokensOut += event.output;
              }
              if (event.cachedInput !== undefined)
                diagnostic.cachedInputTokens =
                  (diagnostic.cachedInputTokens ?? 0) + event.cachedInput;
              finishReason = event.reason;
            }
          }
          diagnostic.status = "completed";
        } finally {
          diagnostic.cumulativeInputTokens = tokensIn;
          diagnostic.cumulativeOutputTokens = tokensOut;
          await this.store.modelRequest?.(input.turnId, diagnostic);
        }
        requestingModel = false;
        await journal.flush();
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
        const exchange: ToolExchange = {
          messages: [{ role: "assistant", content: assistant }],
          calls: [],
        };
        for (const call of pending) {
          signal.throwIfAborted();
          calls++;
          exchange.calls.push(calls);
          exchange.messages.push(
            await session.execute(
              call,
              {
                turnId: input.turnId,
                workspaceId: input.workspaceId,
                callIndex: calls,
              },
              signal,
              emit,
            ),
          );
        }
        exchanges.push(exchange);
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
        await journal.flush();
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
export { agentLimits } from "./limits";
