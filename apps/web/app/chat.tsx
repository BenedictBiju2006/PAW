"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type {
  Conversation,
  Message,
} from "../../../packages/conversations/schema";
import { api } from "../lib/api";
import AISettings, { type AIStatus } from "./ai-settings";
import {
  MessageView,
  persistedMessages,
  type ChatMessage,
} from "./chat-messages";
export default function Chat({
  workspaceId,
  refresh,
}: {
  workspaceId: string;
  refresh: () => void;
}) {
  const base = `workspaces/${workspaceId}/conversations`;
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [next, setNext] = useState<number | null>(null),
    [active, setActive] = useState<Conversation | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [status, setStatus] = useState<AIStatus | null>(null),
    [drawer, setDrawer] = useState(false);
  useEffect(() => {
    let current = true;
    api<{ conversations: Conversation[]; nextOffset: number | null }>(base)
      .then((r) => {
        if (current) {
          setConversations(r.conversations);
          setNext(r.nextOffset);
          setActive(r.conversations.at(-1) ?? null);
        }
      })
      .catch((e) => current && setError(e.message));
    api<AIStatus>("ai-settings")
      .then((s) => current && setStatus(s))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [base]);
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
      <aside className={`conversation-list ${drawer ? "drawer-open" : ""}`}>
        <div className="row">
          <h2>Conversations</h2>
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
      <div className="chat-thread">
        <div className="chat-heading">
          <button
            className="chat-nav-toggle"
            aria-expanded={drawer}
            onClick={() => setDrawer(!drawer)}
          >
            Conversations
          </button>
          <div>
            <h2>{active?.title ?? "Chat"}</h2>
            {status && (
              <select
                aria-label="AI model"
                value={
                  status.configured ? `${status.provider}:${status.model}` : ""
                }
                onChange={(e) => {
                  if (e.target.value === "configure") {
                    setSettings(true);
                    return;
                  }
                  const [provider, model] = e.target.value.split(":");
                  void run(async () =>
                    setStatus(
                      await api<AIStatus>("ai-settings", "PATCH", {
                        provider,
                        model,
                      }),
                    ),
                  );
                }}
              >
                <option value="" disabled>
                  {status.configured ? "Choose model" : "AI not configured"}
                </option>
                {status.configured && !status.models.includes(status.model) && (
                  <option value={`${status.provider}:${status.model}`} disabled>
                    {status.model} (unavailable)
                  </option>
                )}
                {status.providers
                  .filter((p) => p.configured)
                  .map((p) => (
                    <optgroup key={p.id} label={p.name}>
                      {p.models.map((m) => (
                        <option key={m} value={`${p.id}:${m}`}>
                          {m}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                <option value="configure">Add / manage provider keys…</option>
              </select>
            )}
          </div>
          <div className="row">
            <button onClick={() => setSettings(true)}>AI settings</button>
            {active && (
              <details className="conversation-actions">
                <summary>Conversation actions</summary>
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
              </details>
            )}
          </div>
        </div>
        {!status?.configured && (
          <p className="muted">
            Messages can be saved. Add a provider API key in AI settings to
            receive AI responses.
          </p>
        )}
        {status?.warning && (
          <p className="muted" role="status">
            Your soft token warning has been reached. This is not a provider
            billing cap.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!active ? (
          <div className="empty-state">
            <h3>What would you like to create?</h3>
            <p>Start a new conversation in this workspace.</p>
            <button
              className="primary"
              disabled={busy}
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
              Start conversation
            </button>
          </div>
        ) : (
          <ChatThread
            key={active.id}
            workspaceId={workspaceId}
            conversationId={active.id}
            configured={!!status?.configured}
            refresh={refresh}
          />
        )}
      </div>
      {settings && (
        <AISettings close={() => setSettings(false)} updated={setStatus} />
      )}
    </section>
  );
}
const transport = new DefaultChatTransport<ChatMessage>({
  api: "/api/agent",
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (!response.ok) {
      let message = "Unable to start the response.";
      try {
        message = (await response.json()).error ?? message;
      } catch {}
      throw new Error(message);
    }
    return response;
  },
  prepareSendMessagesRequest: ({ body }) => ({ body: body ?? {} }),
});
function ChatThread({
  workspaceId,
  conversationId,
  configured,
  refresh,
}: {
  workspaceId: string;
  conversationId: string;
  configured: boolean;
  refresh: () => void;
}) {
  const base = `workspaces/${workspaceId}/conversations/${conversationId}`;
  const [draft, setDraft] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [history, setHistory] = useState<Message[]>([]),
    [before, setBefore] = useState<number | null>(null),
    [turns, setTurns] = useState<
      {
        id: string;
        status: string;
        notice: string;
        input_tokens: number;
        output_tokens: number;
        provider: string;
        model: string;
        model_requests: number;
        tool_calls: number;
        cached_input_tokens: number | null;
      }[]
    >([]);
  const historyRef = useRef<Message[]>([]);
  const submitting = useRef(false);
  const scroll = useRef<HTMLDivElement>(null),
    nearBottom = useRef(true),
    composer = useRef<HTMLTextAreaElement>(null),
    mounted = useRef(true),
    currentTurn = useRef<string | null>(null),
    lastRequest = useRef<{
      turnId: string;
      workspaceId: string;
      conversationId: string;
      text: string;
    } | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ messages: Message[]; before: number | null }>(
      `${base}/messages?recent=true`,
    );
    if (!mounted.current) return;
    const preserveOlder =
      historyRef.current.length > 0 &&
      historyRef.current[0].sequence < (r.messages[0]?.sequence ?? Infinity);
    const combined = Array.from(
      new Map(
        [...historyRef.current, ...r.messages].map((message) => [
          message.id,
          message,
        ]),
      ).values(),
    ).sort((a, b) => a.sequence - b.sequence);
    historyRef.current = combined;
    setHistory(combined);
    setBefore((previous) => (preserveOlder ? previous : r.before));
    setMessages(persistedMessages(combined));
    try {
      const t = await api<typeof turns>(`${base}/turns`);
      if (mounted.current) {
        setTurns(t);
        setMessages(
          persistedMessages(
            combined,
            Object.fromEntries(t.map((turn) => [turn.id, turn.status])),
          ),
        );
      }
    } catch {}
  }, [base]);
  const { messages, setMessages, sendMessage, status, stop } =
    useChat<ChatMessage>({
      id: conversationId,
      transport,
      onData: (part) => {
        if (mounted.current && part.type === "data-mutation") refresh();
      },
      onFinish: () => {
        if (!mounted.current) return;
        currentTurn.current = null;
        void load().catch((e) => mounted.current && setError(e.message));
        refresh();
      },
      onError: (e) => {
        if (!mounted.current) return;
        setError(
          e.message ||
            "Response interrupted. Reload saved messages before retrying.",
        );
      },
    });
  const running = status === "submitted" || status === "streaming";
  useEffect(() => {
    mounted.current = true;
    load()
      .catch((e) => mounted.current && setError(e.message))
      .finally(() => {
        if (mounted.current) {
          setLoading(false);
          setTimeout(() => composer.current?.focus(), 0);
        }
      });
    return () => {
      mounted.current = false;
      void stop();
      if (currentTurn.current)
        void api("agent/cancel", "POST", {
          turnId: currentTurn.current,
          workspaceId,
          conversationId,
        }).catch(() => {});
    };
  }, [load]);
  useEffect(() => {
    if (nearBottom.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages]);
  async function submit() {
    if (!draft.trim() || running || loading || submitting.current) return;
    submitting.current = true;
    const text = draft.trim();
    setError("");
    if (!configured) {
      try {
        await api(`${base}/messages`, "POST", { text });
        setDraft("");
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        submitting.current = false;
      }
      return;
    }
    const body = {
      turnId: crypto.randomUUID(),
      workspaceId,
      conversationId,
      text,
    };
    lastRequest.current = body;
    currentTurn.current = body.turnId;
    setDraft("");
    try {
      await sendMessage({ text }, { body });
    } finally {
      submitting.current = false;
    }
  }
  async function cancel() {
    const turnId = currentTurn.current;
    if (turnId)
      await api("agent/cancel", "POST", {
        turnId,
        workspaceId,
        conversationId,
      }).catch((e) => setError(e.message));
    await stop();
    setTimeout(() => {
      if (mounted.current) void load().catch((e) => setError(e.message));
    }, 300);
  }
  return (
    <>
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            disabled={running}
            onClick={() => load().catch((e) => setError(e.message))}
          >
            Reload saved messages
          </button>
          {lastRequest.current && (
            <button
              disabled={running}
              onClick={async () => {
                const body = lastRequest.current!;
                setError("");
                await sendMessage(undefined, { body });
              }}
            >
              Check / retry request
            </button>
          )}
        </div>
      )}
      {loading ? (
        <p role="status">Loading conversation…</p>
      ) : (
        <div
          className="chat-messages"
          ref={scroll}
          role="log"
          aria-label="Message history"
          aria-live="polite"
          onScroll={() => {
            const el = scroll.current!;
            nearBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          }}
        >
          {before !== null && (
            <button
              onClick={async () => {
                try {
                  const el = scroll.current!,
                    height = el.scrollHeight;
                  const r = await api<{
                    messages: Message[];
                    before: number | null;
                  }>(`${base}/messages?recent=true&before=${before}`);
                  const combined = [...r.messages, ...history];
                  historyRef.current = combined;
                  nearBottom.current = false;
                  setHistory(combined);
                  setBefore(r.before);
                  setMessages(persistedMessages(combined));
                  requestAnimationFrame(() => {
                    el.scrollTop = el.scrollHeight - height;
                  });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
              disabled={running}
            >
              Load older messages
            </button>
          )}
          {!messages.length && (
            <div className="chat-empty">
              <h3>What would you like to create?</h3>
            </div>
          )}
          {messages.map((m) => (
            <MessageView key={m.id} message={m} />
          ))}
          {running && (
            <p className="muted" role="status">
              {status === "submitted" ? "Starting response…" : "Responding…"}
            </p>
          )}
        </div>
      )}
      {!running && turns[0] && (
        <p className="muted turn-status">
          {turns[0].provider} / {turns[0].model} · {turns[0].status} ·{" "}
          {turns[0].input_tokens} input / {turns[0].output_tokens} output tokens
          · {turns[0].model_requests} model requests · {turns[0].tool_calls}{" "}
          tool calls · cached input {turns[0].cached_input_tokens ?? "unknown"}{" "}
          · cost unknown
          {turns[0].notice ? ` · ${turns[0].notice}` : ""}
          {turns[0].status === "running" && (
            <button
              onClick={async () => {
                await api("agent/cancel", "POST", {
                  turnId: turns[0].id,
                  workspaceId,
                  conversationId,
                });
                await load();
              }}
            >
              Stop active response
            </button>
          )}
        </p>
      )}
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="chat-message">
          Message
        </label>
        <textarea
          ref={composer}
          id="chat-message"
          disabled={loading}
          rows={2}
          maxLength={20000}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
          }}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Message PAW…"
        />
        <div className="composer-actions">
          <span className="muted">Shift+Enter for a new line</span>
          {running ? (
            <button type="button" onClick={cancel}>
              Stop generation
            </button>
          ) : (
            <button className="primary" disabled={loading || !draft.trim()}>
              {configured ? "Send message" : "Save message"}
            </button>
          )}
        </div>
      </form>
    </>
  );
}
