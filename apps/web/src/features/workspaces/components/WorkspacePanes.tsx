"use client";
import dynamic from "next/dynamic";
import Chat from "../../chat/client";
import { isEmptyInterface } from "../../interfaces/public";
import type { WorkspaceController } from "../hooks/useWorkspaceController";
const InterfaceRenderer = dynamic(() => import("../../interfaces/client"), {
  ssr: false,
});
export function WorkspacePanes({ model }: { model: WorkspaceController }) {
  const {
    active,
    collections,
    destination,
    developer,
    epoch,
    report,
    conversations,
    navigate,
    newChatVersion,
  } = model;
  if (!active) return null;
  const workspaceId = active.id;
  return (
    <div className="workspace-main-view" hidden={developer}>
      {destination.kind !== "interface" && (
        <div className="primary-chat">
          <Chat
            workspaceId={workspaceId}
            conversationId={
              destination.kind === "conversation"
                ? destination.conversationId
                : undefined
            }
            controller={conversations}
            newChatVersion={newChatVersion}
            start={async (text, configured) => {
              const conversation = await conversations.create(text, configured);
              navigate({
                kind: "conversation",
                conversationId: conversation.id,
              });
            }}
          />
        </div>
      )}
      <section
        className="primary-interface"
        aria-label="Live interface"
        hidden={destination.kind !== "interface"}
      >
        <div className="interface-content">
          {active.interfaceError ? (
            <div className="empty-state" role="alert">
              <h2>Interface needs recovery</h2>
              <p>{active.interfaceError}</p>
              <button onClick={() => model.setDeveloper(true)}>
                Open Interface Builder
              </button>
            </div>
          ) : !isEmptyInterface(active.interface) ? (
            <InterfaceRenderer
              key={`${active.id}-${epoch}`}
              workspaceId={active.id}
              definition={active.interface}
              collections={collections}
              report={report}
            />
          ) : (
            <div className="empty-state">
              <h2>Your interface has not been created yet.</h2>
              <p>Start a chat to build your shared workspace interface.</p>
              <button onClick={model.newChat}>New chat</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
