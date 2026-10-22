"use client";
import { api } from "../../../shared/http/api";
import { useChatThread } from "../hooks/useChatThread";
import { ChatComposer } from "./ChatComposer";
import { MessageView } from "./MessageView";
export function ChatThread({
  drafts,
  workspaceId,
  conversationId,
  configured,
  refresh,
}: {
  drafts: Map<string, string>;
  workspaceId: string;
  conversationId: string;
  configured: boolean;
  refresh: () => void;
}) {
  const controller = useChatThread({
    drafts,
    workspaceId,
    conversationId,
    configured,
    refresh,
  });
  const {
    loadOlder,
    loading,
    error,
    setError,
    before,
    turns,
    scroll,
    session,
    nearBottom,
    lastRequest,
    load,
    messages,
    sendMessage,
    status,
    running,
  } = controller;
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
            session.scrollTop = el.scrollTop;
            session.nearBottom = nearBottom.current;
          }}
        >
          {before !== null && (
            <button onClick={loadOlder} disabled={running}>
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
          {!running && turns[0] && (
            <p className="muted turn-status">
              {turns[0].provider} / {turns[0].model} · {turns[0].status} ·{" "}
              {turns[0].input_tokens} input / {turns[0].output_tokens} output
              tokens · {turns[0].model_requests} model requests ·{" "}
              {turns[0].tool_calls} tool calls · cached input{" "}
              {turns[0].cached_input_tokens ?? "unknown"} · cost unknown
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
        </div>
      )}
      <ChatComposer controller={controller} configured={configured} />
    </>
  );
}
