"use client";
import type { WorkspaceController } from "../hooks/useWorkspaceController";

export function WorkspaceOverview({ model }: { model: WorkspaceController }) {
  const { setError, busy, workspaces, setNewWorkspace, open } = model;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Your workspaces</h1>
          <p>Create and manage your private workspaces.</p>
        </div>
        <button
          className="primary"
          onClick={() => (setError(""), setNewWorkspace(true))}
        >
          + New workspace
        </button>
      </div>
      <div className="section-line">
        <h2>
          All workspaces <span className="count">{workspaces.length}</span>
        </h2>
        <span className="muted">Your ideas, organized</span>
      </div>
      <div className="workspace-grid">
        {workspaces.map((w, index) => (
          <button
            className="workspace-card"
            key={w.id}
            onClick={() => open(w.id)}
            disabled={busy}
          >
            <h3>{w.name}</h3>
            <p>Open your collections and interface</p>
            <div className="card-footer">
              <span>Updated {new Date(w.updated_at).toLocaleDateString()}</span>
            </div>
          </button>
        ))}
        <button
          className="new-card"
          onClick={() => (setError(""), setNewWorkspace(true))}
        >
          <strong>Create a workspace</strong>
        </button>
      </div>
    </>
  );
}
