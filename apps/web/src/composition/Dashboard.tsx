"use client";
import { AccountDialog, AuthScreen } from "../features/auth/client";
import {
  DeveloperTools,
  useWorkspaceController,
  WorkspaceDialogs,
  WorkspaceOverview,
  WorkspacePanes,
  WorkspaceSettings,
  WorkspaceShell,
} from "../features/workspaces/client";
import { Brand } from "../shared/ui/Brand";
export default function Dashboard({ configured }: { configured: boolean }) {
  const model = useWorkspaceController(configured);
  const {
    user,
    loading,
    error,
    setError,
    notice,
    active,
    developer,
    setDeveloper,
    account,
    setAccount,
    signout,
  } = model;
  if (!configured)
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <Brand />
          <h1>Connect your workspace.</h1>
          <p>
            Set the Supabase project URL and publishable key in the server
            environment, then restart PAW.
          </p>
          <p className="muted">
            See README.md for migration and authentication setup.
          </p>
        </div>
      </main>
    );
  if (loading)
    return (
      <main className="auth-shell">
        <div role="status">
          <Brand />
          <p>Opening your workspaces…</p>
        </div>
      </main>
    );
  if (!user) return <AuthScreen {...model} />;
  return (
    <WorkspaceShell
      model={model}
      dialogs={
        <>
          {account && (
            <AccountDialog
              email={user.email}
              close={() => setAccount(false)}
              signout={signout}
            />
          )}
          <WorkspaceDialogs model={model} />
        </>
      }
    >
      <main className={`content ${active ? "workspace-content" : ""}`}>
        {error && (
          <div className="error" role="alert">
            {error}
            <button
              className="icon"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {!active ? (
          <WorkspaceOverview model={model} />
        ) : (
          <>
            <div className="page-heading">
              <div>
                <h1>{active.name}</h1>
              </div>
              <div className="row">
                <WorkspaceSettings model={model} />
              </div>
            </div>
            <WorkspacePanes model={model} />
            <button
              className="developer-toggle"
              aria-controls="developer-panel"
              aria-expanded={developer}
              onClick={() => {
                const value = !developer;
                setDeveloper(value);
                try {
                  localStorage.setItem("paw.developerTools", String(value));
                } catch {}
              }}
            >
              Developer Tools {developer ? "▴" : "▾"}
            </button>
            <DeveloperTools model={model} />
          </>
        )}
      </main>
    </WorkspaceShell>
  );
}
