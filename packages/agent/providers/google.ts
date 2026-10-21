import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { sdkProvider } from "./sdk";
export const googleProvider = sdkProvider("google", (apiKey, model) =>
  createGoogleGenerativeAI({ apiKey })(model),
);
