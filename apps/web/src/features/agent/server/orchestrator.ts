import { type AssistantContent, type ModelMessage } from "ai";
import "server-only";
import type { ModelProvider } from "../../providers/public";
import { providerError } from "../../providers/public";
import type { ExecutionTools } from "../../tooling/public";
import type { AgentEvent } from "../model/events";
import { bootstrapTools } from "./bootstrap-tools";
import type { Store } from "./contracts";
import { agentLimits, LimitError } from "./limits";
import { bootstrapPrompt } from "./prompts";
import type { TurnStatus } from "./store";
import { TextJournal } from "./text-journal";
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
    const messages = [...input.history];
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
      for (; step < this.limits.steps; step++) {
        signal.throwIfAborted();
        if (JSON.stringify(messages).length > this.limits.contextChars)
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
            tokensIn += event.input;
            tokensOut += event.output;
            finishReason = event.reason;
          }
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
        messages.push({ role: "assistant", content: assistant });
        for (const call of pending) {
          signal.throwIfAborted();
          calls++;
          messages.push(
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
