"use client";
import { useEffect, useRef, useState } from "react";
import type {
  Conversation,
  Message,
} from "../../../packages/conversations/schema";
import { api } from "../lib/api";
export default function Chat({ workspaceId }: { workspaceId: string }) {
  const base = `workspaces/${workspaceId}/conversations`;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationPage, setConversationPage] = useState<number | null>(null);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagePage, setMessagePage] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    api<{ conversations: Conversation[]; nextOffset: number | null }>(base)
      .then((result) => {
        if (current) {
          setConversations(result.conversations);
          setConversationPage(result.nextOffset);
          setActive(result.conversations[0] ?? null);
        }
      })
      .catch((e) => current && setError(e.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
      requestVersion.current++;
    };
  }, [base]);
  useEffect(() => {
    const version = ++requestVersion.current;
    setMessages([]);
    setMessagePage(null);
    setDraft("");
    if (!active) return;
    setLoading(true);
    setError("");
    api<{ messages: Message[]; nextOffset: number | null }>(
      `${base}/${active.id}/messages`,
    )
      .then((result) => {
        if (version === requestVersion.current) {
          setMessages(result.messages);
          setMessagePage(result.nextOffset);
        }
      })
      .catch((e) => version === requestVersion.current && setError(e.message))
      .finally(() => version === requestVersion.current && setLoading(false));
  }, [base, active?.id]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="chat" aria-label="Workspace chat">
      <aside className="conversation-list">
        <div className="row">
          <h2>Conversations</h2>
          <button
            disabled={busy || loading}
            onClick={() =>
              run(async () => {
                const c = await api<Conversation>(base, "POST", {
                  title: "New conversation",
                });
                setConversations((items) => [c, ...items]);
                setActive(c);
              })
            }
          >
            New conversation
          </button>
        </div>
        <nav aria-label="Conversations">
          {conversations.map((c) => (
            <button
              className={`nav-item ${active?.id === c.id ? "selected" : ""}`}
              key={c.id}
              disabled={busy}
              onClick={() => setActive(c)}
            >
              {c.title}
            </button>
          ))}
        </nav>
        {conversationPage !== null && (
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await api<{
                  conversations: Conversation[];
                  nextOffset: number | null;
                }>(`${base}?offset=${conversationPage}`);
                setConversations((items) => [
                  ...items,
                  ...result.conversations.filter(
                    (c) => !items.some((i) => i.id === c.id),
                  ),
                ]);
                setConversationPage(result.nextOffset);
              })
            }
          >
            More conversations
          </button>
        )}
      </aside>
      <div className="chat-thread">
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {active && (
          <div className="chat-heading">
            <h2>{active.title}</h2>
            <div className="row">
              <button
                disabled={busy || loading}
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
                disabled={busy || loading}
                className="danger-text"
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
                      const items = conversations.filter(
                        (c) => c.id !== active.id,
                      );
                      setConversations(items);
                      setActive(items[0] ?? null);
                    });
                }}
              >
                Delete conversation
              </button>
            </div>
          </div>
        )}
        <p className="muted">
          Messages are saved to this workspace. AI responses are not yet
          available.
        </p>
        {loading ? (
          <p role="status">Loading conversation…</p>
        ) : !active ? (
          <div className="empty-state">
            <h3>No conversations yet</h3>
            <p>Create a conversation to save messages about this workspace.</p>
          </div>
        ) : (
          <>
            <div
              className="chat-messages"
              role="log"
              aria-label="Message history"
              aria-live="polite"
            >
              {!messages.length && (
                <p className="muted">
                  No messages yet. Write your first message below.
                </p>
              )}
              {messages.map((message) => (
                <article
                  className={`chat-message ${message.role}`}
                  key={message.id}
                >
                  <div className="row">
                    <strong>
                      {message.role === "user"
                        ? "You"
                        : message.role === "assistant"
                          ? "Assistant"
                          : message.role}
                    </strong>
                    <time dateTime={message.created_at}>
                      {new Date(message.created_at).toLocaleString()}
                    </time>
                  </div>
                  {message.content.map((block, index) =>
                    block.type === "text" ? (
                      <p key={index}>{block.text}</p>
                    ) : (
                      <details key={index}>
                        <summary>
                          {block.toolId} ·{" "}
                          {block.type === "tool_call"
                            ? block.status
                            : block.isError
                              ? "failed"
                              : "completed"}
                        </summary>
                        <pre>{JSON.stringify(block, null, 2)}</pre>
                      </details>
                    ),
                  )}
                </article>
              ))}
              {messagePage !== null && (
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const result = await api<{
                        messages: Message[];
                        nextOffset: number | null;
                      }>(`${base}/${active.id}/messages?offset=${messagePage}`);
                      setMessages((items) => [...items, ...result.messages]);
                      setMessagePage(result.nextOffset);
                    })
                  }
                >
                  Load next messages
                </button>
              )}
              <div ref={end} />
            </div>
            <form
              className="chat-composer"
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.trim() || messagePage !== null) return;
                run(async () => {
                  const m = await api<Message>(
                    `${base}/${active.id}/messages`,
                    "POST",
                    { text: draft },
                  );
                  setMessages((items) => [...items, m]);
                  setDraft("");
                });
              }}
            >
              <label htmlFor="chat-message">Message</label>
              <textarea
                id="chat-message"
                rows={3}
                maxLength={50000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={busy}
                placeholder="Write a message…"
              />
              {messagePage !== null && (
                <p className="muted">
                  Load the remaining messages before adding a new one.
                </p>
              )}
              <button
                className="primary"
                disabled={
                  busy || loading || !draft.trim() || messagePage !== null
                }
              >
                {busy ? "Saving…" : "Send message"}
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
