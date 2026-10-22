"use client";
import {useWorkspaceController} from "../features/workspaces/hooks/useWorkspaceController";
import {AuthScreen} from "../features/auth/components/AuthScreen";
import {Brand} from "../shared/ui/Brand";
import {api} from "../shared/http/api";
import type {Workspace} from "../features/workspaces/model/types";
import type {Collection} from "../features/collections/model/schema";
import {CollectionDialog} from "../features/collections/components/CollectionDialog";
import {NameDialog} from "../features/workspaces/components/NameDialog";
import {WorkspaceSidebar} from "../features/workspaces/components/WorkspaceSidebar";
import {WorkspaceOverview} from "../features/workspaces/components/WorkspaceOverview";
import {WorkspacePanes} from "../features/workspaces/components/WorkspacePanes";
import {DeveloperTools} from "../features/workspaces/components/DeveloperTools";
import {WorkspaceSettings} from "../features/workspaces/components/WorkspaceSettings";
export default function Dashboard({configured}:{configured:boolean}){
const model=useWorkspaceController(configured);
const {user,setUser,loading,setLoading,error,setError,notice,setNotice,busy,setBusy,workspaces,setWorkspaces,active,setActive,collections,setCollections,tab,setTab,developer,setDeveloper,interfaceExpanded,setInterfaceExpanded,primaryView,setPrimaryView,epoch,setEpoch,selectedCollection,setSelectedCollection,signup,setSignup,newWorkspace,setNewWorkspace,newCollection,setNewCollection,account,setAccount,renaming,setRenaming,report,run,refreshList,loadWorkspace,open,signout,auth,save,currentCollection}=model;
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
  if (!user)
    return (
      <AuthScreen {...model} />
    );
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
      </div>
      {account && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Account settings"
          >
            <button
              className="modal-close"
              aria-label="Close"
              onClick={() => setAccount(false)}
            >
              Close
            </button>
            <h2>Account</h2>
            <p>Signed in as {user.email}</p>
            <button
              onClick={async () => {
                await signout();
                setAccount(false);
              }}
            >
              Sign out
            </button>
          </section>
        </div>
      )}
      {newWorkspace && (
        <NameDialog
          error={error}
          title="Create workspace"
          label="Workspace name"
          submit="Create workspace"
          busy={busy}
          close={() => setNewWorkspace(false)}
          save={(value) =>
            run(async () => {
              const w = await api<Workspace>("workspaces", "POST", {
                name: value,
              });
              await refreshList();
              setNewWorkspace(false);
              setActive(w);
              window.history.replaceState(null, "", `?workspace=${w.id}`);
              setCollections([]);
              setSelectedCollection("");
              setTab("workspace");
            })
          }
        />
      )}
      {renaming && active && (
        <NameDialog
          error={error}
          title="Rename workspace"
          label="Workspace name"
          initial={active.name}
          submit="Save name"
          busy={busy}
          close={() => setRenaming(false)}
          save={(value) =>
            run(async () => {
              setActive(
                await api(`workspaces/${active.id}`, "PATCH", { name: value }),
              );
              await refreshList();
              setRenaming(false);
            })
          }
        />
      )}
      {newCollection && active && (
        <CollectionDialog
          error={error}
          busy={busy}
          close={() => setNewCollection(false)}
          save={(value) =>
            run(async () => {
              const c = await api<Collection>(
                `workspaces/${active.id}/collections`,
                "POST",
                value,
              );
              setCollections([...collections, c]);
              setSelectedCollection(c.id);
              setNewCollection(false);
              setTab("data");
            })
          }
        />
      )}
    </div>
  );

}
