import { createGroq } from "@ai-sdk/groq";
import "server-only";
import { sdkProvider } from "./sdk";
export const groqProvider = sdkProvider("groq", (apiKey, model) =>
  createGroq({ apiKey })(model),
);
