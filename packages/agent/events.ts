export type Activity = {
  invocationId: string;
  toolId: string;
  arguments: Record<string, unknown>;
  status: "running" | "completed" | "failed" | "awaiting_confirmation";
  result?: unknown;
};
export type AgentEvent =
  | { type: "text"; id: string; text: string }
  | { type: "activity"; activity: Activity }
  | { type: "mutation"; workspaceId: string }
  | {
      type: "turn";
      id: string;
      status: string;
      notice?: string | null;
      usage?: { input: number; output: number };
    };
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        /password|secret|api.?key|authorization|credential/i.test(key)
          ? "[redacted]"
          : redact(v),
      ]),
    );
  if (typeof value === "string")
    return value.replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[redacted]");
  return value;
}
