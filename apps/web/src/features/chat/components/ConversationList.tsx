"use client";
import type { ConversationNavigation } from "../hooks/useConversationNavigation";
export function ConversationList({
  controller,
  selectedId,
  select,
  removed,
}: {
  controller: ConversationNavigation;
  selectedId?: string;
  select: (id: string) => void;
  removed: (id: string) => void;
}) {
  return (
    <>
      <div className="sidebar-label">YOUR CHATS</div>
      {controller.error && (
        <p className="error" role="alert">
          {controller.error}
        </p>
      )}
      <nav className="conversation-history" aria-label="Conversations">
        {controller.conversations.map((conversation) => (
          <div className="conversation-row" key={conversation.id}>
            <button
              className={`nav-item ${selectedId === conversation.id ? "selected" : ""}`}
              aria-current={selectedId === conversation.id ? "page" : undefined}
              title={conversation.title}
              onClick={() => select(conversation.id)}
            >
              <span className="truncate">{conversation.title}</span>
            </button>
            <details className="conversation-menu">
              <summary aria-label={`Actions for ${conversation.title}`}>
                ⋯
              </summary>
              <div>
                <button
                  disabled={controller.busy}
                  onClick={() => void controller.rename(conversation)}
                >
                  Rename conversation
                </button>
                <button
                  disabled={controller.busy}
                  onClick={() =>
                    void controller.remove(conversation).then((ok) => {
                      if (ok) removed(conversation.id);
                    })
                  }
                >
                  Delete conversation
                </button>
              </div>
            </details>
          </div>
        ))}
        {!controller.conversations.length && (
          <p className="sidebar-empty muted">Your chats will appear here.</p>
        )}
        {controller.next !== null && (
          <button
            disabled={controller.busy}
            onClick={() => void controller.more()}
          >
            More conversations
          </button>
        )}
      </nav>
    </>
  );
}
