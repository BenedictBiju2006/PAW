import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { sdkProvider } from "./sdk";
import { googleProtocol } from "./google-protocol";
export const googleProvider = sdkProvider(
  "google",
  (apiKey, model) => createGoogleGenerativeAI({ apiKey })(model),
  googleProtocol,
);
