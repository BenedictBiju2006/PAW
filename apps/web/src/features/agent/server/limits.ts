import "server-only";
export function agentLimits(env: NodeJS.ProcessEnv = process.env) {
  const n = (key: string, value: number, max: number) =>
    Math.min(max, Math.max(1, Number(env[key]) || value));
  return {
    steps: n("PAW_AGENT_MAX_STEPS", 24, 40),
    calls: n("PAW_AGENT_MAX_TOOL_CALLS", 50, 100),
    durationMs: n("PAW_AGENT_TIMEOUT_MS", 120000, 300000),
    outputTokens: n("PAW_AGENT_MAX_OUTPUT_TOKENS", 8000, 20000),
    resultChars: n("PAW_AGENT_MAX_RESULT_CHARS", 30000, 60000),
    contextChars: n("PAW_AGENT_MAX_CONTEXT_CHARS", 160000, 300000),
  };
}

export class LimitError extends Error {}
