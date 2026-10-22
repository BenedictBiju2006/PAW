"use client";
import type { ChatThreadController } from "../hooks/useChatThread";
export function ChatComposer({
  controller,
  configured,
}: {
  controller: Pick<
    ChatThreadController,
    | "draft"
    | "setDraft"
    | "loading"
    | "composer"
    | "running"
    | "submit"
    | "cancel"
  >;
  configured: boolean;
}) {
  const { draft, setDraft, loading, composer, running, submit, cancel } =
    controller;
  return (
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
        rows={1}
        maxLength={20000}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
  );
}
