import type { ModelMessage } from "ai";
import { createHash } from "node:crypto";
import "server-only";
import type { ProviderEvent } from "../../providers/public";
import { FailureTracker } from "./failure-tracker";
import type { ExecutionTools, ToolResult } from "../../tooling/public";
import { redact, type AgentEvent } from "../model/events";
import { dispatch } from "./bootstrap-tools";
import type { Store } from "./contracts";
import { agentLimits, LimitError } from "./limits";
const fail = (code: string, message: string) => ({
  ok: false as const,
  error: {
    code,
    message,
    guidance: "Inspect the tool schema or current resource before retrying.",
  },
});
export class ToolSession {
  private described = new Set<string>();
  private failures = new FailureTracker();
  private repetitions = new Map<
    string,
    { toolId: string; count: number; failed?: boolean }
  >();
  private completedMutations = new Map<string, ToolResult>();
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
      result: ToolResult | undefined;
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
    const repeated = (this.repetitions.get(signature)?.count ?? 0) + 1;
    this.repetitions.set(signature, { toolId, count: repeated });
    const definition = this.executor.registry.resolve(toolId);
    if (!result)
      result = this.failures.before(
        toolId,
        args,
        definition?.inputSchema.safeParse(args).success ?? false,
      );
    if (
      !result &&
      ![
        "search_tools",
        "describe_tool",
        "list_resources",
        "inspect_resource",
      ].includes(toolId) &&
      !this.described.has(toolId)
    )
      result = await this.executor.schemaRecovery(toolId, args);
    if (!result && repeated > 3)
      result = fail(
        "repeated_operation",
        "This operation has repeated three times. Inspect a different resource or explain the blocker.",
      );
    if (!result && this.completedMutations.has(signature))
      result = this.completedMutations.get(signature)!;
    else if (!result) {
      result = await this.executor.execute(toolId, args);
      if (result.ok && definition?.sideEffects === "write")
        this.completedMutations.set(signature, result);
    }
    const actual = result as { ok: boolean; error?: { code?: string } };
    if (
      !result.ok &&
      ["conflict", "operation_failed", "confirmation_required"].includes(
        result.error.code,
      )
    )
      this.repetitions.delete(signature);
    const serialized = JSON.stringify(redact(result));
    const boundedResult: ToolResult =
      serialized.length > this.limits.resultChars ||
      Buffer.byteLength(serialized) > 60000
        ? fail(
            "result_too_large",
            "Result exceeded the response bound. Narrow the query, lower its limit, or inspect an individual resource/component.",
          )
        : JSON.parse(serialized);
    let safeResult = this.failures.observe(toolId, args, boundedResult);
    const finalText = JSON.stringify(safeResult);
    if (
      finalText.length > this.limits.resultChars ||
      Buffer.byteLength(finalText) > 60000
    )
      safeResult = fail(
        "result_too_large",
        "Recovery feedback exceeded the response bound. Use a focused discovery call.",
      );
    // A schema was discovered only if its successful result actually reached the
    // model, not when an oversized/failed description was replaced by an error.
    if (!safeResult.ok) {
      const attempt = this.repetitions.get(signature);
      if (attempt) attempt.failed = true;
    }
    if (safeResult.ok) {
      for (const [key, attempt] of this.repetitions)
        if (
          attempt.failed &&
          (attempt.toolId === toolId ||
            (toolId === "search_ui_components" &&
              attempt.toolId === "inspect_resource"))
        )
          this.repetitions.delete(key);
      const recovered =
        toolId === "describe_tool" && typeof args.toolId === "string"
          ? args.toolId
          : toolId === "list_resources"
            ? "inspect_resource"
            : undefined;
      if (toolId === "describe_tool" && recovered)
        this.described.add(recovered);
      if (recovered)
        for (const [key, attempt] of this.repetitions)
          if (attempt.toolId === recovered) this.repetitions.delete(key);
      if (toolId === "search_tools")
        for (const [key, attempt] of this.repetitions)
          if (!this.executor.registry.resolve(attempt.toolId))
            this.repetitions.delete(key);
    }
    await this.store.event(input.turnId, `result:${invocationId}`, "tool", [
      {
        type: "tool_result",
        invocationId,
        toolId,
        result: safeResult,
        isError: !safeResult.ok,
      },
    ]);
    emit({
      type: "activity",
      activity: {
        invocationId,
        toolId,
        arguments: safeArgs,
        status: safeResult.ok
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
          output: {
            type: "json",
            value: JSON.parse(JSON.stringify(safeResult)),
          },
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
