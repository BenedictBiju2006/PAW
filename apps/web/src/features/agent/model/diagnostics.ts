/** Provider token counts are separate from approximate serialized context sizes. */
export type ModelRequestDiagnostic = {
  request: number;
  provider: string;
  model: string;
  status: "completed" | "incomplete";
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  contextCharacters: {
    system: number;
    history: number;
    tools: number;
    exchanges: number;
  };
};
