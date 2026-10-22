"use client";
import type { ReactNode } from "react";
import type { WorkspaceController } from "../hooks/useWorkspaceController";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
export function WorkspaceShell({
  model,
  children,
  dialogs,
}: {
  model: WorkspaceController;
  children: ReactNode;
  dialogs: ReactNode;
}) {
  const { active, setAccount, signout } = model;
  return (
    <div className={`app-shell ${active ? "workspace-open" : ""}`}>
      <WorkspaceSidebar model={model} />
      <div className="main-area">
        <header className="topbar">
          <span>
            Personal workspace{" "}
            <span className="muted"> / {active?.name ?? "Overview"}</span>
          </span>
          <button onClick={() => setAccount(true)}>Account</button>
          <button className="mobile-signout" onClick={signout}>
            Sign out
          </button>
        </header>
        {children}
      </div>
      {dialogs}
    </div>
  );
}
