import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import type { ModelProvider } from "../provider";
export const openaiProvider: ModelProvider = {
  id: "openai",
  capabilities: { streaming: true, tools: true, hostedMcp: false },
  async *stream(input) {
    const openai = createOpenAI({ apiKey: input.apiKey });
    const result = streamText({
      model: openai.responses(input.model),
      system: input.system,
      messages: input.messages,
      tools: input.tools,
      abortSignal: input.signal,
      maxOutputTokens: input.maxOutputTokens,
      maxRetries: 0,
      // Raw SDK errors can include request/context data. Normalize stream error
      // events in the orchestrator instead of allowing default console logging.
      onError: () => {},
      providerOptions: { openai: { store: false } },
    });
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") yield { type: "text", text: part.text };
      else if (part.type === "tool-call")
        yield {
          type: "call",
          id: part.toolCallId,
          name: part.toolName,
          args: part.input,
        };
      else if (part.type === "finish")
        yield {
          type: "usage",
          input: part.totalUsage.inputTokens ?? 0,
          output: part.totalUsage.outputTokens ?? 0,
          reason: part.finishReason,
        };
      else if (part.type === "error") throw part.error;
      else if (part.type === "abort")
        throw new DOMException("Cancelled", "AbortError");
    }
  },
};
