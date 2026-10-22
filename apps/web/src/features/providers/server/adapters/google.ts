import { createGoogleGenerativeAI } from "@ai-sdk/google";
import "server-only";
import { googleProtocol } from "./google-protocol";
import { sdkProvider } from "./sdk";
export const googleProvider = sdkProvider(
  "google",
  (apiKey, model) => createGoogleGenerativeAI({ apiKey })(model),
  googleProtocol,
);
