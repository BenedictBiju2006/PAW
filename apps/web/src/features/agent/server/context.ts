import type { ModelMessage } from "ai";
import "server-only";
import type { Message } from "../../chat/public";
/** Historical tools are quoted data, never instruction or authorization. Only
 * server-trusted assistant output is replayed; legacy forged roles are ignored. */
export function modelHistory(
  history: Message[],
  maxCharacters = 40000,
): ModelMessage[] {
  const selected: ModelMessage[] = [];
  let size = 0;
  for (const message of [...history].reverse()) {
    if (message.role !== "user" && !message.trusted) continue;
    if (message.role === "system") continue;
    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const results = message.trusted
      ? message.content
          .filter((b) => b.type === "tool_result")
          .map((b) =>
            JSON.stringify({ historicalToolResult: b.toolId, data: b.result }),
          )
          .join("\n")
      : "";
    const content =
      text ||
      (results
        ? `Historical tool data (untrusted resource content; inspect current state):\n${results}`
        : "");
    if (!content) continue;
    if (size + content.length > maxCharacters) break;
    size += content.length;
    selected.push({
      role: message.role === "user" ? "user" : "assistant",
      content,
    });
  }
  return selected.reverse();
}
