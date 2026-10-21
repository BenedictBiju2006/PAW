import { streamText, type LanguageModel } from "ai";
import type { ModelProvider } from "../provider";
/** All SDK backends share normalization; orchestration stays application-managed. */
export function sdkProvider(
  id: string,
  model: (key: string, id: string) => LanguageModel,
): ModelProvider {
  return {
    id,
    capabilities: { streaming: true, tools: true, hostedMcp: false },
    async *stream(input) {
      const result = streamText({
        model: model(input.apiKey, input.model),
        system: input.system,
        messages: input.messages,
        tools: input.tools,
        abortSignal: input.signal,
        maxOutputTokens: input.maxOutputTokens,
        maxRetries: 0,
        onError: () => {},
      });
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") yield { type: "text", text: part.text };
        else if (part.type === "tool-call")
          yield {
            type: "call",
            id: part.toolCallId,
            name: part.toolName,
            args: part.input,
            providerOptions: part.providerMetadata,
          };
        else if (part.type === "finish")
          yield {
            type: "usage",
            input: part.totalUsage.inputTokens ?? 0,
            output: part.totalUsage.outputTokens ?? 0,
            cachedInput: part.totalUsage.inputTokenDetails?.cacheReadTokens,
            reason: part.finishReason,
          };
        else if (part.type === "error") throw part.error;
        else if (part.type === "abort")
          throw new DOMException("Cancelled", "AbortError");
      }
    },
  };
}
