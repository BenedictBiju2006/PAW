import type { ModelMessage, ToolSet, ToolCallPart } from "ai";
export type ProviderEvent =
  | { type: "text"; text: string }
  | {
      type: "call";
      id: string;
      name: string;
      args: unknown;
      providerOptions?: ToolCallPart["providerOptions"];
    }
  | {
      type: "usage";
      input: number;
      output: number;
      reason: string;
      cachedInput?: number;
    };
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
export class ProviderProtocolError extends Error {
  readonly name = "ProviderProtocolError";
  constructor(public readonly reason: "tool_schema" | "thought_signature") {
    super(reason);
  }
}
export type ProviderRequestContext = {
  request: number;
  phase: "initial" | "after_tool_results";
};
/** Only fixed categories and known schema keywords reach notices, never raw bodies. */
function googleRejection(
  error: unknown,
  body: string,
  code: number | undefined,
): string | undefined {
  if (error instanceof ProviderProtocolError)
    return error.reason === "thought_signature"
      ? "Gemini function-call replay is missing the original thought signature. No replay request was sent; PAW will not substitute a dummy signature."
      : "Gemini tool declaration contains an unsupported reference or union. No model request was sent.";
  if (code !== 400 && code !== 422) return;
  // Only known protocol field names and indices may be copied from an error.
  const field = body.match(
    /(?:tools|contents)\[\d{1,3}\](?:\[(?:\d{1,3}|arguments|toolId)\]|\.(?:function_declarations|functionDeclarations|parameters_json_schema|parametersJsonSchema|parameters|properties|arguments|items|parts|functionCall|functionResponse|thought_signature|thoughtSignature))*/,
  )?.[0];
  const http = `HTTP ${code}${field ? `; field ${field}` : ""}`;
  if (/thought[_ -]?signature/i.test(body))
    return `Gemini rejected a missing or invalid thought signature on function-call replay (${http}). Preserve the original signed parts and call order.`;
  if (
    /schema|function[_ ]?declarations|parametersJsonSchema|parameters_json_schema|\$ref|additionalProperties|propertyNames/i.test(
      body,
    )
  ) {
    const keywords = [
      "$ref",
      "definitions",
      "$defs",
      "additionalProperties",
      "propertyNames",
      "anyOf",
      "oneOf",
      "allOf",
    ].filter((key) => body.includes(key));
    return `Gemini rejected the tool declaration schema (${http})${keywords.length ? `: ${keywords.join(", ")}` : "."} Inspect the Google wire declaration; the server validation schema is separate.`;
  }
  if (
    /function[_ ]?response|function call.*(?:order|number|position)|functionCall.*(?:order|number|position)/i.test(
      body,
    )
  )
    return `Gemini rejected the function-call/result ordering or pairing (${http}). Return every result after its model call group, with matching call IDs.`;
  if (
    /generation[_ ]?config|maxOutputTokens|max_output_tokens|temperature|top_p/i.test(
      body,
    )
  )
    return `Gemini rejected the generation configuration (${http}). Check the selected model's supported request parameters.`;
  return;
}
export function providerError(
  error: unknown,
  provider = "Model provider",
  context?: ProviderRequestContext,
): string {
  const notice = normalizedProviderError(error, provider);
  return context && provider === "google"
    ? `Gemini model request ${context.request} (${context.phase === "initial" ? "initial request" : "after tool results"}): ${notice}`
    : notice;
}
function normalizedProviderError(
  error: unknown,
  provider = "Model provider",
): string {
  const e = error as {
    statusCode?: number;
    status?: number;
    name?: string;
    responseBody?: string;
  };
  const code = e?.statusCode ?? e?.status;
  if (error instanceof ProviderProtocolError)
    return googleRejection(error, "", undefined)!;
  const body =
    typeof e?.responseBody === "string" ? e.responseBody.slice(0, 20000) : "";
  if (/API_KEY_INVALID|API_KEY_EXPIRED|invalid_api_key/i.test(body))
    return `${provider} rejected the API credentials. Replace this provider's key in AI settings.`;
  if (/model_not_found|model_decommissioned/i.test(body))
    return `${provider} model unavailable or not found for this API version/project. Choose another enabled model in AI settings using your saved key.`;
  if (code === 401)
    return `${provider} rejected the API credentials. Validate or replace this provider's key in AI settings.`;
  if (
    code === 403 ||
    /MODEL_ACCESS_DENIED|MODEL_RESTRICTED|not available (?:for|to) (?:new|your)|new (?:projects|users)|does not have access|access (?:is )?restricted/i.test(
      body,
    )
  )
    return `${provider} model access is restricted for this project or account. Choose a replacement model in AI settings using your saved key, or check provider project permissions. No provider was switched.`;
  if (provider === "google" || provider === "Gemini") {
    const detail = googleRejection(error, body, code);
    if (detail) return detail;
  }
  if (
    /function calling.{0,60}(?:not supported|unsupported)|(?:not support|unsupported).{0,60}(?:function calling|tools)|UNSUPPORTED_TOOL/i.test(
      body,
    )
  )
    return `${provider} model does not support the required structured tool calling. Choose a tool-capable replacement model using your saved key.`;
  if (code === 404)
    return `${provider} model unavailable or not found for this API version/project. Choose another enabled model in AI settings using your saved key.`;
  if (code === 429) {
    const quota =
      /insufficient_quota|quota_exceeded|billing_hard_limit_reached/i.test(
        body,
      );
    return quota
      ? `${provider} API quota exhausted. Check your account quota and billing. No provider was switched automatically.`
      : `${provider} rate limit or quota reached. Check your account limits and retry later, or explicitly select another provider.`;
  }
  if (code && code >= 500)
    return `${provider} is experiencing an outage. Retry later; completed changes are preserved.`;
  if (e?.name === "AbortError" || e?.name === "TimeoutError")
    return "Generation stopped or timed out. Completed workspace changes are preserved.";
  if (e?.name === "TypeError" || e?.name === "AI_RetryError")
    return `${provider} network failure. Check connectivity and retry later.`;
  if (e?.name === "AI_UnsupportedFunctionalityError")
    return `${provider} does not support the required structured tool calling. Choose another enabled model.`;
  if (code === 400 || code === 422)
    return `${provider} rejected the request or tool-calling format. Choose a supported model; completed changes are preserved.`;
  return `${provider} is unavailable or rejected the request. Check key, model access and network, then reload saved messages.`;
}
