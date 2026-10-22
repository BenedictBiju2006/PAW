"use client";
import { api } from "../../../shared/http/api";
import type { ConversationNavigation } from "../hooks/useConversationNavigation";
import type { Conversation } from "../model/schema";
export function ConversationActions({
  controller,
}: {
  controller: ConversationNavigation;
}) {
  const {
    base,
    conversations,
    setConversations,
    active,
    setActive,
    busy,
    run,
  } = controller;
  if (!active) return null;
  return (
    <details className="conversation-actions">
      <summary aria-label="Conversation actions">Actions</summary>
      <button
        disabled={busy}
        onClick={() => {
          const title = prompt("Conversation title", active.title);
          if (title?.trim())
            run(async () => {
              const c = await api<Conversation>(
                `${base}/${active.id}`,
                "PATCH",
                { title },
              );
              setConversations((items) =>
                items.map((i) => (i.id === c.id ? c : i)),
              );
              setActive(c);
            });
        }}
      >
        Rename conversation
      </button>
      <button
        disabled={busy}
        onClick={() => {
          if (
            confirm(
              `Delete “${active.title}” and all its messages? This cannot be undone.`,
            )
          )
            run(async () => {
              await api(`${base}/${active.id}`, "DELETE", {
                confirmed: true,
              });
              const items = conversations.filter((c) => c.id !== active.id);
              setConversations(items);
              setActive(items[0] ?? null);
            });
        }}
      >
        Delete conversation
      </button>
    </details>
  );
}
