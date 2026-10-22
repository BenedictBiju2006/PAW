"use client";
import { useRef, useState } from "react";
import { useChatSessions } from "./ChatSessionProvider";
import { useConversationDraft } from "../hooks/useConversationDraft";
import { ChatComposer } from "./ChatComposer";
export function NewChat({
  workspaceId,
  configured,
  start,
}: {
  workspaceId: string;
  configured: boolean;
  start: (text: string) => Promise<void>;
}) {
  const sessions = useChatSessions();
  const [draft, setDraft] = useConversationDraft(
    `${workspaceId}:new`,
    sessions.drafts,
  );
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  async function submit() {
    if (!draft.trim() || submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError("");
    try {
      await start(draft.trim());
      setDraft("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="chat-messages" role="log" aria-label="Message history">
        <div className="chat-empty">
          <h2>What would you like to create?</h2>
          <p>One workspace. Many conversations. One shared interface.</p>
        </div>
      </div>
      <ChatComposer
        configured={configured}
        controller={{
          draft,
          setDraft,
          loading,
          composer,
          running: false,
          submit,
          cancel: async () => {},
        }}
      />
    </>
  );
}
