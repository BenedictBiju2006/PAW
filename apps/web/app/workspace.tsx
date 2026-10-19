"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Collection, Field, Workspace } from "../../../packages/core/schema";
import { api } from "../lib/api";
import { DataView } from "./renderer";
import dynamic from "next/dynamic";
import InterfaceBuilder from "./interface-builder";
import Chat from "./chat";
import { isEmptyInterface } from "../../../packages/a2ui/document";
const InterfaceRenderer = dynamic(() => import("./a2ui-runtime"), {
  ssr: false,
});

type Summary = Pick<Workspace, "id" | "name" | "revision" | "updated_at">;
export default function Dashboard({ configured }: { configured: boolean }) {
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [workspaces, setWorkspaces] = useState<Summary[]>([]);
  const [active, setActive] = useState<Workspace | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tab, setTab] = useState<"workspace" | "data" | "interface" | "chat">(
    "workspace",
  );
  const [epoch, setEpoch] = useState(0);
  const [selectedCollection, setSelectedCollection] = useState("");
  const [signup, setSignup] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState(false);
  const [newCollection, setNewCollection] = useState(false);
  const [account, setAccount] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const report = useCallback((message: string) => setError(message), []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refreshList() {
    setWorkspaces(await api("workspaces"));
  }
  useEffect(() => {
    if (!configured) return;
    let current = true;
    api("auth/session")
      .then(async ({ user }) => {
        if (!current) return;
        setUser(user);
        if (user) {
          const list = await api<Summary[]>("workspaces");
          if (current) {
            setWorkspaces(list);
            const requested = new URLSearchParams(window.location.search).get(
              "workspace",
            );
            if (requested) await loadWorkspace(requested);
          }
        }
      })
      .catch((e) => current && setError(e.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [configured]);
  async function loadWorkspace(id: string) {
    const [workspace, items] = await Promise.all([
      api<Workspace>(`workspaces/${id}`),
      api<Collection[]>(`workspaces/${id}/collections`),
    ]);
    setActive(workspace);
    setCollections(items);
    setSelectedCollection(items[0]?.id ?? "");
    setTab("workspace");
    setEpoch((e) => e + 1);
    window.history.replaceState(null, "", `?workspace=${id}`);
  }
  async function open(id: string) {
    await run(() => loadWorkspace(id));
  }
  async function signout() {
    await run(async () => {
      await api("auth/signout", "POST", {});
      setUser(null);
      setActive(null);
      setWorkspaces([]);
      setSignup(false);
      window.history.replaceState(null, "", "/");
    });
  }
  async function auth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const result = await api(`auth/${signup ? "signup" : "signin"}`, "POST", {
        email: form.get("email"),
        password: form.get("password"),
      });
      if (result.authenticated) {
        const session = await api("auth/session");
        setUser(session.user);
        await refreshList();
      } else setNotice(result.message);
    });
  }
  async function save(definition: unknown) {
    if (!active) return;
    const workspace = await api<Workspace>(
      `workspaces/${active.id}/interface`,
      "PUT",
      { definition, revision: active.revision },
    );
    setActive(workspace);
    setNotice("Interface saved. Your records are preserved.");
    await refreshList();
  }
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
      <main className="auth-shell">
        <section className="auth-card">
          <h1>PAW</h1>
          <p>{signup ? "Create your account." : "Welcome back."}</p>
          <div className="auth-modes">
            <button
              className={!signup ? "primary" : ""}
              onClick={() => {
                setSignup(false);
                setError("");
                setNotice("");
              }}
            >
              Sign in
            </button>
            <button
              className={signup ? "primary" : ""}
              onClick={() => {
                setSignup(true);
                setError("");
                setNotice("");
              }}
            >
              Sign up
            </button>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
            </div>
          )}
          <form onSubmit={auth}>
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                minLength={8}
                maxLength={128}
                autoComplete={signup ? "new-password" : "current-password"}
                required
                placeholder="At least 8 characters"
              />
            </label>
            <button disabled={busy} className="primary">
              {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
            </button>
          </form>
        </section>
      </main>
    );
  const currentCollection = collections.find(
    (c) => c.id === selectedCollection,
  );
  return (
    <div className="app-shell">
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
        <main className="content">
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
                  All workspaces{" "}
                  <span className="count">{workspaces.length}</span>
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
                      <span>
                        Updated {new Date(w.updated_at).toLocaleDateString()}
                      </span>
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
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <h1>{active.name}</h1>
                  <p>
                    {collections.length} collection
                    {collections.length === 1 ? "" : "s"} · Interface revision{" "}
                    {active.revision}
                  </p>
                </div>
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
                  </button>
                </div>
              </div>
              <div className="tabs" role="tablist" aria-label="Workspace views">
                {(["workspace", "data", "interface", "chat"] as const).map(
                  (t) => (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={tab === t}
                      onClick={() => setTab(t)}
                    >
                      {t === "workspace"
                        ? "Workspace"
                        : t === "data"
                          ? "Collections & data"
                          : t === "interface"
                            ? "Interface builder"
                            : "Chat"}
                    </button>
                  ),
                )}
              </div>
              {tab === "workspace" &&
                (active.interfaceError ? (
                  <div className="error" role="alert">
                    {active.interfaceError} Open Interface Builder to recover
                    the original definition.
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
                  <section className="empty-state">
                    <h2>No interface yet</h2>
                    <p>
                      Add a collection to store your data, then build an
                      interface with forms, tables, text, and charts.
                    </p>
                    <button
                      className="primary"
                      onClick={() => {
                        setTab("data");
                        (setError(""), setNewCollection(true));
                      }}
                    >
                      + Add your first collection
                    </button>
                    <button
                      className="link"
                      onClick={() => setTab("interface")}
                    >
                      Open interface builder
                    </button>
                  </section>
                ))}
              {tab === "data" && (
                <>
                  <div className="section-line">
                    <div className="row">
                      <label className="sr-only" htmlFor="collection-select">
                        Collection
                      </label>
                      <select
                        id="collection-select"
                        value={selectedCollection}
                        onChange={(e) => setSelectedCollection(e.target.value)}
                      >
                        <option value="" disabled>
                          Select collection
                        </option>
                        {collections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={() => (setError(""), setNewCollection(true))}
                    >
                      + New collection
                    </button>
                  </div>
                  {currentCollection ? (
                    <>
                      <details className="schema-details">
                        <summary>
                          Collection schema · {currentCollection.fields.length}{" "}
                          fields
                        </summary>
                        <code>Collection ID: {currentCollection.id}</code>
                        <div className="field-chips">
                          {currentCollection.fields.map((f) => (
                            <span key={f.key}>
                              {f.label}{" "}
                              <small>
                                {f.type}
                                {f.required ? " · required" : ""}
                              </small>
                            </span>
                          ))}
                        </div>
                      </details>
                      <DataView
                        key={`${currentCollection.id}-${epoch}`}
                        workspaceId={active.id}
                        collection={currentCollection}
                        mode="table"
                        report={report}
                      />
                    </>
                  ) : (
                    <div className="empty-state">
                      <h2>No collections yet</h2>
                      <p>
                        A collection defines the fields your records can hold.
                      </p>
                      <button
                        className="primary"
                        onClick={() => (setError(""), setNewCollection(true))}
                      >
                        + Create collection
                      </button>
                    </div>
                  )}
                </>
              )}
              {tab === "chat" && (
                <Chat key={active.id} workspaceId={active.id} />
              )}
              {tab === "interface" && (
                <InterfaceBuilder
                  workspace={active}
                  collections={collections}
                  busy={busy}
                  save={save}
                  reload={() => open(active.id)}
                />
              )}
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
function Brand() {
  return <div className="brand">PAW</div>;
}
function NameDialog({
  error,
  title,
  label,
  initial = "",
  submit,
  busy,
  close,
  save,
}: {
  title: string;
  label: string;
  initial?: string;
  submit: string;
  error: string;
  busy: boolean;
  close: () => void;
  save: (value: string) => void;
}) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button className="modal-close icon" onClick={close} aria-label="Close">
          ×
        </button>
        <h2>{title}</h2>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(String(new FormData(e.currentTarget).get("name")));
          }}
        >
          <label>
            {label}
            <input
              autoFocus
              name="name"
              defaultValue={initial}
              maxLength={100}
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : submit}
          </button>
        </form>
      </section>
    </div>
  );
}
function CollectionDialog({
  error,
  busy,
  close,
  save,
}: {
  error: string;
  busy: boolean;
  close: () => void;
  save: (value: { name: string; fields: Field[] }) => void;
}) {
  const [fields, setFields] = useState<Field[]>([
    { key: "title", label: "Title", type: "string", required: true },
  ]);
  const update = (index: number, patch: Partial<Field>) =>
    setFields(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  return (
    <div className="modal-backdrop">
      <section
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="Create collection"
      >
        <button className="modal-close icon" onClick={close} aria-label="Close">
          ×
        </button>
        <h2>Create collection</h2>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <p>
          Define your fields. Schemas stay fixed to protect existing records.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save({
              name: String(new FormData(e.currentTarget).get("name")),
              fields,
            });
          }}
        >
          <label>
            Collection name
            <input
              name="name"
              required
              maxLength={100}
              autoFocus
              placeholder="e.g. Reading list"
            />
          </label>
          <div className="field-builder">
            {fields.map((f, i) => (
              <div className="field-row" key={i}>
                <label>
                  Label
                  <input
                    value={f.label}
                    maxLength={100}
                    required
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                </label>
                <label>
                  Field key
                  <input
                    value={f.key}
                    pattern="[A-Za-z][A-Za-z0-9_]{0,63}"
                    required
                    onChange={(e) => update(i, { key: e.target.value })}
                  />
                </label>
                <label>
                  Type
                  <select
                    value={f.type}
                    onChange={(e) =>
                      update(i, {
                        type: e.target.value as Field["type"],
                        options:
                          e.target.value === "enum" ? ["Option 1"] : undefined,
                      })
                    }
                  >
                    {["string", "number", "boolean", "date", "enum"].map(
                      (t) => (
                        <option key={t}>{t}</option>
                      ),
                    )}
                  </select>
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => update(i, { required: e.target.checked })}
                  />
                  Required
                </label>
                <button
                  type="button"
                  aria-label={`Remove ${f.label} field`}
                  disabled={fields.length === 1}
                  onClick={() =>
                    setFields(fields.filter((_, index) => i !== index))
                  }
                >
                  ×
                </button>
                {f.type === "enum" && (
                  <label className="enum-options">
                    Options (comma separated)
                    <input
                      required
                      value={f.options?.join(",")}
                      onChange={(e) =>
                        update(i, {
                          options: e.target.value
                            .split(",")
                            .map((s) => s.trim()),
                        })
                      }
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
          <div className="row">
            <button
              type="button"
              disabled={fields.length >= 30}
              onClick={() =>
                setFields([
                  ...fields,
                  {
                    key: `field${fields.length + 1}`,
                    label: "New field",
                    type: "string",
                    required: false,
                  },
                ])
              }
            >
              + Add field
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Creating…" : "Create collection"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
