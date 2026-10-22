import type { ModelMessage } from "ai";
import { createHash } from "node:crypto";
import "server-only";
import type { ProviderEvent } from "../../providers/public";
import type { ExecutionTools } from "../../tooling/public";
import { redact, type AgentEvent } from "../model/events";
import { dispatch } from "./bootstrap-tools";
import type { Store } from "./contracts";
import { agentLimits, LimitError } from "./limits";
const fail = (code: string, message: string) => ({
  ok: false,
  error: {
    code,
    message,
    guidance: "Inspect the tool schema or current resource before retrying.",
  },
});
export class ToolSession {
  private described = new Set<string>();
  private repetitions = new Map<string, number>();
  private completedMutations = new Map<string, unknown>();
  constructor(
    private executor: ExecutionTools,
    private store: Store,
    private limits: ReturnType<typeof agentLimits>,
  ) {}
  async execute(
    call: Extract<ProviderEvent, { type: "call" }>,
    input: { turnId: string; workspaceId: string; callIndex: number },
    signal: AbortSignal,
    emit: (e: AgentEvent) => void,
  ): Promise<ModelMessage> {
    const invocationId = `${input.turnId}:${input.callIndex}`;
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
        if (!this.described.has(toolId))
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
    else result = fail("invalid_arguments", "Expected an arguments object.");
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
    const repeated = (this.repetitions.get(signature) ?? 0) + 1;
    this.repetitions.set(signature, repeated);
    const definition = this.executor.registry.resolve(toolId);
    if (!result && repeated > 3)
      result = fail(
        "repeated_operation",
        "This operation has repeated three times. Inspect a different resource or explain the blocker.",
      );
    if (!result && this.completedMutations.has(signature))
      result = this.completedMutations.get(signature);
    else if (!result) {
      result = await this.executor.execute(toolId, args);
      if (definition?.sideEffects === "write")
        this.completedMutations.set(signature, result);
    }
    const actual = result as { ok: boolean; error?: { code?: string } };
    if (
      actual.ok &&
      toolId === "describe_tool" &&
      typeof args.toolId === "string"
    )
      this.described.add(args.toolId);
    const serialized = JSON.stringify(redact(result));
    const safeResult =
      serialized.length > this.limits.resultChars ||
      Buffer.byteLength(serialized) > 60000
        ? fail(
            "result_too_large",
            "Result exceeded the response bound. Narrow the query, lower its limit, or inspect an individual resource/component.",
          )
        : JSON.parse(serialized);
    await this.store.event(input.turnId, `result:${invocationId}`, "tool", [
      {
        type: "tool_result",
        invocationId,
        toolId,
        result: safeResult,
        isError: !actual.ok,
      },
    ]);
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
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: call.id,
          toolName: call.name,
          output: { type: "json", value: safeResult },
        },
      ],
    };
  }
}
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
