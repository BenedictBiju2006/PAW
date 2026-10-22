"use client";
import { useEffect, useState } from "react";
import { api } from "../../../shared/http/api";
import AISettings, { ModelSelector } from "../../providers/client";
import type { AIStatus } from "../../providers/public";
import type { ConversationNavigation } from "../hooks/useConversationNavigation";
import { ChatThread } from "./ChatThread";
import { NewChat } from "./NewChat";
export default function ChatPanel({
  workspaceId,
  conversationId,
  controller,
  newChatVersion,
  start,
}: {
  workspaceId: string;
  conversationId?: string;
  controller: ConversationNavigation;
  newChatVersion: number;
  start: (text: string, configured: boolean) => Promise<void>;
}) {
  const [status, setStatus] = useState<AIStatus | null>(null),
    [settings, setSettings] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    api<AIStatus>("ai-settings")
      .then((s) => current && setStatus(s))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
  const conversation = controller.conversations.find(
    (c) => c.id === conversationId,
  );
  return (
    <section className="chat" aria-label="Workspace chat">
      <div className="chat-thread">
        <header className="chat-heading">
          <h2 title={conversation?.title}>
            {conversationId
              ? (conversation?.title ?? "Conversation")
              : "New chat"}
          </h2>
          <div className="chat-model">
            {status && (
              <ModelSelector
                status={status}
                onConfigure={() => setSettings(true)}
                onSelect={async (provider, model) => {
                  try {
                    setStatus(
                      await api<AIStatus>("ai-settings", "PATCH", {
                        provider,
                        model,
                      }),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
            )}
          </div>
          <button onClick={() => setSettings(true)}>AI settings</button>
        </header>
        {!status?.configured && (
          <p className="muted chat-config-notice">
            Messages can be saved. Add a provider API key in AI settings for AI
            responses.
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
        {conversationId ? (
          <ChatThread
            key={`${workspaceId}:${conversationId}`}
            drafts={controller.sessions.drafts}
            workspaceId={workspaceId}
            conversationId={conversationId}
            configured={!!status?.configured}
            refresh={() => {}}
          />
        ) : (
          <NewChat
            key={`${workspaceId}:${newChatVersion}`}
            workspaceId={workspaceId}
            configured={!!status?.configured}
            start={(text) => start(text, !!status?.configured)}
          />
        )}
      </div>
      {settings && (
        <AISettings close={() => setSettings(false)} updated={setStatus} />
      )}
    </section>
  );
}
