import { streamText, type LanguageModel } from "ai";
import type { ModelProvider, ProviderEvent } from "../../model/provider";
export type SdkInput = Parameters<ModelProvider["stream"]>[0];
type CallMetadata = NonNullable<
  Extract<ProviderEvent, { type: "call" }>["providerOptions"]
>;
function mergeMetadata(
  previous?: CallMetadata,
  next?: CallMetadata,
): CallMetadata {
  return Object.fromEntries(
    [
      ...new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})]),
    ].map((namespace) => [
      namespace,
      { ...previous?.[namespace], ...next?.[namespace] },
    ]),
  );
}
export interface SdkProtocol {
  prepare(input: SdkInput): Promise<SdkInput>;
  call(
    call: Extract<ProviderEvent, { type: "call" }>,
  ): Extract<ProviderEvent, { type: "call" }>;
}
/** All SDK backends share normalization; orchestration stays application-managed. */
export function sdkProvider(
  id: string,
  model: (key: string, id: string) => LanguageModel,
  protocol?: SdkProtocol,
): ModelProvider {
  return {
    id,
    capabilities: { streaming: true, tools: true, hostedMcp: false },
    async *stream(input) {
      const request = protocol ? await protocol.prepare(input) : input;
      const result = streamText({
        model: model(input.apiKey, input.model),
        system: input.system,
        messages: request.messages,
        tools: request.tools,
        abortSignal: input.signal,
        maxOutputTokens: input.maxOutputTokens,
        maxRetries: 0,
        onError: () => {},
      });
      const inputMetadata = new Map<string, CallMetadata>();
      for await (const part of result.fullStream) {
        // Some Google streams attach the signature to a later input delta, while
        // the SDK's input-end and final tool-call echo stale input-start metadata.
        // Keep the latest real delta metadata; never overwrite it with that echo.
        if (
          protocol &&
          (part.type === "tool-input-start" ||
            part.type === "tool-input-delta") &&
          part.providerMetadata
        ) {
          inputMetadata.set(
            part.id,
            mergeMetadata(inputMetadata.get(part.id), part.providerMetadata),
          );
        }
        if (part.type === "text-delta") yield { type: "text", text: part.text };
        else if (part.type === "tool-call") {
          const call: Extract<ProviderEvent, { type: "call" }> = {
            type: "call",
            id: part.toolCallId,
            name: part.toolName,
            args: part.input,
            providerOptions: protocol
              ? mergeMetadata(
                  part.providerMetadata,
                  inputMetadata.get(part.toolCallId),
                )
              : part.providerMetadata,
          };
          inputMetadata.delete(part.toolCallId);
          yield protocol ? protocol.call(call) : call;
        } else if (part.type === "finish")
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
