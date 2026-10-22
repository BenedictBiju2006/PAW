"use client";
import { api } from "../../../shared/http/api";
import type { WorkspaceController } from "../hooks/useWorkspaceController";
export function WorkspaceSettings({ model }: { model: WorkspaceController }) {
  const { busy, active, setActive, setRenaming, run, refreshList } = model;
  if (!active) return null;
  return (
    <details className="workspace-settings">
      <summary aria-label="Workspace settings" title="Workspace settings">
        ⋯
      </summary>
      <div className="row">
        <button onClick={() => setRenaming(true)}>Rename</button>
        <button
          className="danger-text"
          disabled={busy}
          onClick={() => {
            if (
              confirm(
                `Delete “${active.name}” and all its data? This cannot be undone.`,
              )
            )
              run(async () => {
                await api(`workspaces/${active.id}`, "DELETE", {
                  confirmed: true,
                });
                setActive(null);
                window.history.replaceState(null, "", "/");
                await refreshList();
              });
          }}
        >
          Delete workspace
        </button>{" "}
      </div>
    </details>
  );
}
