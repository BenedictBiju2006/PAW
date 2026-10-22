"use client";
import { Brand } from "../../../shared/ui/Brand";
import type { WorkspaceController } from "../hooks/useWorkspaceController";
export function WorkspaceSidebar({ model }: { model: WorkspaceController }) {
  const {
    user,
    setError,
    busy,
    workspaces,
    active,
    setActive,
    setNewWorkspace,
    open,
    signout,
  } = model;
  if (!user) return null;
  return (
    <aside className="sidebar">
      <Brand />
      <div className="sidebar-label">YOUR SPACE</div>
      <button
        className={`nav-item ${!active ? "selected" : ""}`}
        aria-label="All workspaces"
        onClick={() => {
          setActive(null);
          window.history.replaceState(null, "", "/");
          setError("");
        }}
      >
        <span>All workspaces</span>
        <span className="count">{workspaces.length}</span>
      </button>
      <div className="sidebar-label row">
        WORKSPACES
        <button
          aria-label="New workspace"
          className="icon"
          onClick={() => (setError(""), setNewWorkspace(true))}
        >
          +
        </button>
      </div>
      <nav aria-label="Workspaces">
        {workspaces.map((w) => (
          <button
            key={w.id}
            className={`nav-item ${active?.id === w.id ? "selected" : ""}`}
            aria-label={`Open ${w.name}`}
            disabled={busy}
            onClick={() => open(w.id)}
          >
            <span className="truncate">{w.name}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="truncate">
          <strong>Your account</strong>
          <small>{user.email}</small>
        </div>
        <button className="icon" aria-label="Sign out" onClick={signout}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
