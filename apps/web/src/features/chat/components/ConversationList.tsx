"use client";
import { api } from "../../../shared/http/api";
import type { ConversationNavigation } from "../hooks/useConversationNavigation";
import type { Conversation } from "../model/schema";
export function ConversationList({
  controller,
}: {
  controller: ConversationNavigation;
}) {
  const {
    base,
    navigationPanel,
    closeDrawer,
    conversations,
    setConversations,
    next,
    setNext,
    active,
    setActive,
    busy,
    drawer,
    setDrawer,
    run,
  } = controller;
  return (
    <aside
      ref={navigationPanel}
      hidden={!drawer}
      id="conversation-navigation"
      className="conversation-list"
      aria-label="Conversation navigation"
    >
      <div className="row">
        <h2>Conversations</h2>
        <button className="conversation-close" onClick={closeDrawer}>
          Close conversations
        </button>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const c = await api<Conversation>(base, "POST", {
                title: "New conversation",
              });
              setConversations((items) => [c, ...items]);
              setActive(c);
              setDrawer(false);
            })
          }
        >
          New conversation
        </button>
      </div>
      <nav aria-label="Conversations">
        {conversations.map((c) => (
          <button
            key={c.id}
            disabled={busy}
            className={`nav-item ${active?.id === c.id ? "selected" : ""}`}
            aria-current={active?.id === c.id ? "page" : undefined}
            onClick={() => {
              setActive(c);
              setDrawer(false);
            }}
          >
            {c.title}
          </button>
        ))}
      </nav>
      {next !== null && (
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api<{
                conversations: Conversation[];
                nextOffset: number | null;
              }>(`${base}?offset=${next}`);
              setConversations((items) => [
                ...items,
                ...r.conversations.filter(
                  (c) => !items.some((i) => i.id === c.id),
                ),
              ]);
              setNext(r.nextOffset);
            })
          }
        >
          More conversations
        </button>
      )}
    </aside>
  );
}
