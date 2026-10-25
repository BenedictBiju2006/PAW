import type { ModelMessage } from "ai";
import { createHash } from "node:crypto";
import "server-only";
import type { ProviderEvent } from "../../providers/public";
import { FailureTracker } from "./failure-tracker";
import type { ExecutionTools, ToolResult } from "../../tooling/public";
import { redact, type AgentEvent } from "../model/events";
import { decodeInvocation } from "./bootstrap-tools";
import { TurnKnowledge } from "../../tooling/server/public";
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
  private knowledge: TurnKnowledge;
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
  ) {
    this.knowledge = new TurnKnowledge(executor);
  }
  async execute(
    call: Extract<ProviderEvent, { type: "call" }>,
    input: { turnId: string; workspaceId: string; callIndex: number },
    signal: AbortSignal,
    emit: (e: AgentEvent) => void,
  ): Promise<ModelMessage> {
    const invocationId = `${input.turnId}:${input.callIndex}`;
    const decoded = decodeInvocation(call);
    const toolId = decoded.ok ? decoded.toolId : call.name;
    const args = decoded.ok ? decoded.args : {};
    let result: ToolResult | undefined = decoded.ok ? undefined : decoded;
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
    const definition = this.executor.registry.resolve(toolId);
    const argumentCheck = definition?.inputSchema.safeParse(args);
    const signature = createHash("sha256")
      .update(
        toolId + canonical(argumentCheck?.success ? argumentCheck.data : args),
      )
      .digest("hex");
    const repeated = (this.repetitions.get(signature)?.count ?? 0) + 1;
    this.repetitions.set(signature, { toolId, count: repeated });
    if (!result)
      result = this.failures.before(
        toolId,
        args,
        argumentCheck?.success ?? false,
        definition?.policy,
      );
    if (!result && !this.knowledge.version(toolId))
      result = await this.executor.schemaRecovery(toolId, args);
    if (!result && repeated > 3 && !definition?.policy.reuse)
      result = fail(
        "repeated_operation",
        "This operation has repeated three times. Inspect a different resource or explain the blocker.",
      );
    if (!result) {
      result = await this.executor.execute(toolId, args, {
        schemaVersion: this.knowledge.version(toolId)!,
        previousResult: this.completedMutations.get(signature),
      });
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
    const receipts = this.executor.disclosures(result);
    const prepared = this.knowledge.prepare(
      toolId,
      args,
      signature,
      result,
      receipts,
    );
    const serialized = JSON.stringify(redact(prepared));
    const boundedResult: ToolResult =
      serialized.length > this.limits.resultChars ||
      Buffer.byteLength(serialized) > 60000
        ? fail(
            "result_too_large",
            "Result exceeded the response bound. Narrow the query, lower its limit, or inspect an individual resource/component.",
          )
        : JSON.parse(serialized);
    let safeResult = boundedResult.ok
      ? boundedResult
      : this.failures.observe(toolId, args, boundedResult, definition?.policy);
    const finalText = JSON.stringify(safeResult);
    if (
      finalText.length > this.limits.resultChars ||
      Buffer.byteLength(finalText) > 60000
    )
      safeResult = fail(
        "result_too_large",
        "Recovery feedback exceeded the response bound. Use a focused discovery call.",
      );
    await this.store.event(input.turnId, `result:${invocationId}`, "tool", [
      {
        type: "tool_result",
        invocationId,
        toolId,
        result: safeResult,
        isError: !safeResult.ok,
      },
    ]);
    const accepted = this.knowledge.commit(
      toolId,
      signature,
      result,
      safeResult,
      receipts,
      invocationId,
    );
    if (!safeResult.ok) {
      const attempt = this.repetitions.get(signature);
      if (attempt) attempt.failed = true;
    } else {
      this.failures.observe(
        toolId,
        args,
        safeResult,
        definition?.policy,
        accepted,
      );
      for (const [key, attempt] of this.repetitions)
        if (attempt.failed && this.failures.recovered.includes(attempt.toolId))
          this.repetitions.delete(key);
    }
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
