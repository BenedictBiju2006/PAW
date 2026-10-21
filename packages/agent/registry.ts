import { z } from "zod";
import { ServiceError } from "../core/services";
import { openaiProvider } from "./providers/openai";
import { googleProvider } from "./providers/google";
import { groqProvider } from "./providers/groq";
import { providerError } from "./provider";
export const providerId = z.enum(["openai", "google", "groq"]);
export type ProviderId = z.infer<typeof providerId>;
const definitions = {
  openai: {
    name: "OpenAI",
    adapter: openaiProvider,
    variable: "PAW_OPENAI_MODELS",
    defaults: ["gpt-4.1-mini", "gpt-4.1"],
    dashboard: "https://platform.openai.com/usage",
  },
  google: {
    name: "Gemini",
    adapter: googleProvider,
    variable: "PAW_GOOGLE_MODELS",
    defaults: ["gemini-2.5-flash", "gemini-2.5-pro"],
    dashboard: "https://aistudio.google.com/usage",
  },
  groq: {
    name: "Groq",
    adapter: groqProvider,
    variable: "PAW_GROQ_MODELS",
    defaults: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    dashboard: "https://console.groq.com/usage",
  },
} as const;
export function resolveProvider(id: unknown) {
  return definitions[providerId.parse(id)];
}
export function providerModels(
  id: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
) {
  const p = definitions[id];
  return [
    ...new Set(
      (env[p.variable] ?? p.defaults.join(","))
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[a-zA-Z0-9/._-]{1,100}$/.test(s)),
    ),
  ].slice(0, 20);
}
export function providerCatalog(env: NodeJS.ProcessEnv = process.env) {
  return providerId.options.map((id) => ({
    id,
    name: definitions[id].name,
    models: providerModels(id, env),
    dashboard: definitions[id].dashboard,
  }));
}
export function validateModel(
  id: ProviderId,
  model: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!providerModels(id, env).includes(model))
    throw new ServiceError(
      "Model unavailable or not enabled for structured tool calling. Choose another model in AI settings.",
    );
}
/** Metadata-only access validation. The server allowlist attests tool support separately. */
export async function validateProviderKey(
  id: ProviderId,
  model: string,
  key: string,
  request: typeof fetch = fetch,
) {
  const endpoints = {
    openai: `https://api.openai.com/v1/models/${encodeURIComponent(model)}`,
    google: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
    groq: `https://api.groq.com/openai/v1/models/${encodeURIComponent(model)}`,
  };
  let response: Response;
  try {
    response = await request(endpoints[id], {
      headers:
        id === "google"
          ? { "x-goog-api-key": key }
          : { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch {
    throw new ServiceError(
      `${definitions[id].name} network failure while validating access. Try again later.`,
      502,
    );
  }
  if (!response.ok) {
    const status = response.status;
    // Inspect machine-readable codes only; never expose upstream error text.
    const failure = await response.json().catch(() => null);
    const errorCode =
      typeof failure?.error?.code === "string" ? failure.error.code : "";
    const reasons = Array.isArray(failure?.error?.details)
      ? failure.error.details
          .map((detail: { reason?: unknown }) =>
            typeof detail?.reason === "string" ? detail.reason : "",
          )
          .join(" ")
      : "";
    const errorType =
      typeof failure?.error?.type === "string" ? failure.error.type : "";
    throw new ServiceError(
      providerError(
        {
          statusCode: status,
          responseBody: `${errorCode} ${errorType} ${reasons}`,
        },
        definitions[id].name,
      ),
      status >= 500 ? 502 : 400,
    );
  }
  if (id === "google") {
    let metadata: { supportedGenerationMethods?: string[] };
    try {
      metadata = await response.json();
    } catch {
      throw new ServiceError("Gemini returned invalid model metadata.", 502);
    }
    if (!metadata.supportedGenerationMethods?.includes("generateContent"))
      throw new ServiceError(
        "This Gemini model does not support content generation required for PAW tools.",
      );
  } else await response.body?.cancel();
}
