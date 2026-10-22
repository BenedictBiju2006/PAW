"use client";
import { Brand } from "../../../shared/ui/Brand";
import { ConversationList } from "../../chat/client";
import { isEmptyInterface } from "../../interfaces/public";
import type { WorkspaceController } from "../hooks/useWorkspaceController";
import { WorkspaceSettings } from "./WorkspaceSettings";
export function WorkspaceSidebar({
  model,
  close = () => {},
}: {
  model: WorkspaceController;
  close?: () => void;
}) {
  const {
    user,
    active,
    workspaces,
    busy,
    open,
    overview,
    setNewWorkspace,
    setAccount,
    destination,
    navigate,
    newChat,
    conversations,
    setDeveloper,
    developer,
  } = model;
  if (!user) return null;
  const go = (action: () => void) => {
    action();
    close();
  };
  return (
    <>
      <div className="sidebar-top">
        <Brand />
        <button
          className="sidebar-close"
          onClick={close}
          aria-label="Close navigation"
        >
          ×
        </button>
      </div>
      <button
        className={`nav-item ${!active ? "selected" : ""}`}
        onClick={() => go(overview)}
        aria-label="All workspaces"
      >
        {active ? "← All workspaces" : "All workspaces"}
      </button>
      {active ? (
        <>
          <div className="workspace-context">
            <h1 title={active.name} className="truncate">
              {active.name}
            </h1>
            <WorkspaceSettings model={model} />
          </div>
          <button
            className={`nav-item ${!developer && destination.kind === "interface" ? "selected" : ""}`}
            aria-label="Interface"
            aria-current={
              !developer && destination.kind === "interface"
                ? "page"
                : undefined
            }
            onClick={() => go(() => navigate({ kind: "interface" }))}
          >
            <span>Interface</span>
            {!active.interfaceError && !isEmptyInterface(active.interface) && (
              <span
                className="interface-available"
                aria-label="Interface available"
              >
                ●
              </span>
            )}
          </button>
          <button className="nav-item new-chat" onClick={() => go(newChat)}>
            + New chat
          </button>
          <ConversationList
            controller={conversations}
            selectedId={
              !developer && destination.kind === "conversation"
                ? destination.conversationId
                : undefined
            }
            select={(id) =>
              go(() => navigate({ kind: "conversation", conversationId: id }))
            }
            removed={(id) => {
              if (
                destination.kind === "conversation" &&
                destination.conversationId === id
              )
                newChat();
            }}
          />
          <button
            className={`nav-item sidebar-settings ${developer ? "selected" : ""}`}
            aria-expanded={developer}
            onClick={() => go(() => setDeveloper(!developer))}
          >
            Developer Tools
          </button>
        </>
      ) : (
        <>
          <div className="sidebar-label">WORKSPACES</div>
          <button
            className="nav-item"
            onClick={() => go(() => setNewWorkspace(true))}
          >
            + New workspace
          </button>
          <nav className="workspace-history" aria-label="Workspaces">
            {workspaces.map((workspace) => (
              <button
                className="nav-item"
                key={workspace.id}
                disabled={busy}
                title={workspace.name}
                aria-label={`Open ${workspace.name}`}
                onClick={() => go(() => void open(workspace.id))}
              >
                <span className="truncate">{workspace.name}</span>
              </button>
            ))}
          </nav>
        </>
      )}
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => go(() => setAccount(true))}>
          Account settings
        </button>
        <small className="truncate" title={user.email}>
          {user.email}
        </small>
        <button className="nav-item" onClick={model.signout}>
          Sign out
        </button>
      </div>
    </>
  );
}
