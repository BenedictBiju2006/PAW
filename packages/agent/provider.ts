import type { ModelMessage, ToolSet } from "ai";
export type ProviderEvent =
  | { type: "text"; text: string }
  | { type: "call"; id: string; name: string; args: unknown }
  | { type: "usage"; input: number; output: number; reason: string };
export interface ModelProvider {
  id: string;
  capabilities: { streaming: boolean; tools: boolean; hostedMcp: boolean };
  stream(input: {
    model: string;
    apiKey: string;
    system: string;
    messages: ModelMessage[];
    tools: ToolSet;
    signal: AbortSignal;
    maxOutputTokens: number;
  }): AsyncIterable<ProviderEvent>;
}
export function providerError(error: unknown): string {
  const e = error as { statusCode?: number; status?: number; name?: string };
  const code = e?.statusCode ?? e?.status;
  if (code === 401 || code === 403)
    return "OpenAI rejected the API key or model access. Replace or validate your key in AI settings.";
  if (code === 429)
    return "OpenAI rate limit or quota reached. Check API billing and limits, then try a new request later.";
  if (e?.name === "AbortError" || e?.name === "TimeoutError")
    return "Generation stopped or timed out. Completed workspace changes are preserved.";
  return "The model provider is unavailable or rejected the request. Check your API key, model access and network, then reload saved messages.";
}
