"use client";
import { api } from "../../../shared/http/api";
import AISettings, { ModelSelector } from "../../providers/client";
import type { AIStatus } from "../../providers/public";
import { useConversationNavigation } from "../hooks/useConversationNavigation";
import type { Conversation } from "../model/schema";
import { ChatThread } from "./ChatThread";
import { ConversationActions } from "./ConversationActions";
import { ConversationList } from "./ConversationList";
export default function Chat({
  workspaceId,
  refresh,
}: {
  workspaceId: string;
  refresh: () => void;
}) {
  const controller = useConversationNavigation(workspaceId);
  const {
    drafts,
    base,
    navigationToggle,
    closeDrawer,
    setConversations,
    active,
    setActive,
    error,
    busy,
    settings,
    setSettings,
    status,
    setStatus,
    drawer,
    setDrawer,
    run,
  } = controller;
  return (
    <section
      className="chat"
      aria-label="Workspace chat"
      onKeyDown={(event) => {
        if (event.key === "Escape" && drawer) {
          event.preventDefault();
          closeDrawer();
        }
      }}
    >
      {drawer && (
        <button
          className="conversation-backdrop"
          tabIndex={-1}
          aria-label="Dismiss conversations"
          onClick={closeDrawer}
        />
      )}
      <ConversationList controller={controller} />
      <div className="chat-thread">
        <div className="chat-heading">
          <button
            className="chat-nav-toggle"
            ref={navigationToggle}
            aria-controls="conversation-navigation"
            aria-expanded={drawer}
            onClick={() => setDrawer(!drawer)}
          >
            Conversations
          </button>
          <div className="chat-model">
            <h2>{active?.title ?? "Chat"}</h2>
            {status && (
              <ModelSelector
                status={status}
                onConfigure={() => setSettings(true)}
                onSelect={(provider, model) =>
                  run(async () =>
                    setStatus(
                      await api<AIStatus>("ai-settings", "PATCH", {
                        provider,
                        model,
                      }),
                    ),
                  )
                }
              />
            )}
          </div>
          <div className="row">
            <button onClick={() => setSettings(true)}>AI settings</button>
            {active && <ConversationActions controller={controller} />}
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
            drafts={drafts}
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
