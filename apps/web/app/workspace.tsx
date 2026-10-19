"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Collection,
  Field,
  Interface,
  Workspace,
} from "../../../packages/core/schema";
import { api } from "../lib/api";
import { DataView, InterfaceRenderer } from "./renderer";

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
  const [tab, setTab] = useState<"workspace" | "data" | "interface">(
    "workspace",
  );
  const [epoch, setEpoch] = useState(0);
  const [draft, setDraft] = useState("");
  const [selectedCollection, setSelectedCollection] = useState("");
  const [signup, setSignup] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState(false);
  const [newCollection, setNewCollection] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [history, setHistory] = useState<
    { revision: number; definition: Interface }[]
  >([]);
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
    setDraft(JSON.stringify(workspace.interface, null, 2));
    setSelectedCollection(items[0]?.id ?? "");
    setHistory([]);
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
    setDraft(JSON.stringify(workspace.interface, null, 2));
    setHistory([]);
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
        <div className="auth-story">
          <Brand />
          <span className="eyebrow">
            A LITTLE STRUCTURE. A LOT OF POSSIBILITY.
          </span>
          <h1>
            Your ideas.
            <br />A place to grow.
          </h1>
          <p>
            Make a workspace, give your data a home, and shape an interface that
            feels like yours.
          </p>
          <div className="story-art" aria-hidden="true">
            <div>
              Collections <span>↗</span>
            </div>
            <div>
              Interfaces <span>◫</span>
            </div>
            <div>
              Everything in its place <span>✳</span>
            </div>
          </div>
          <small>Persistent by design. Private to you.</small>
        </div>
        <section className="auth-card">
          <span className="eyebrow">WELCOME TO PAW</span>
          <h2>{signup ? "Make yourself at home." : "Good to see you."}</h2>
          <p>
            {signup
              ? "Create an account to start your first workspace."
              : "Sign in to pick up where you left off."}
          </p>
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
              {busy
                ? "Please wait…"
                : signup
                  ? "Create account ↗"
                  : "Sign in ↗"}
            </button>
          </form>
          <p className="auth-switch">
            {signup ? "Already have an account?" : "New here?"}{" "}
            <button
              className="link"
              onClick={() => {
                setSignup(!signup);
                setError("");
                setNotice("");
              }}
            >
              {signup ? "Sign in" : "Create an account"}
            </button>
          </p>
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
          ◫ <span>All workspaces</span>
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
              <span className="workspace-dot" />{" "}
              <span className="truncate">{w.name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="avatar">{user.email[0].toUpperCase()}</div>
          <div className="truncate">
            <strong>Your account</strong>
            <small>{user.email}</small>
          </div>
          <button className="icon" aria-label="Sign out" onClick={signout}>
            ↗
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <span>
            Personal workspace{" "}
            <span className="muted"> / {active?.name ?? "Overview"}</span>
          </span>
          <span className="private-badge">● Private to you</span>
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
                  <span className="eyebrow">A PLACE FOR WHAT’S NEXT</span>
                  <h1>
                    Your workspaces<span className="accent">.</span>
                  </h1>
                  <p>
                    Small ideas, big plans. Keep them all in a space of their
                    own.
                  </p>
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
                    <div className={`card-symbol tone-${index % 3}`}>
                      {["◫", "✳", "◈"][index % 3]}
                    </div>
                    <h3>{w.name}</h3>
                    <p>Open your collections and interface</p>
                    <div className="card-footer">
                      <span>
                        Updated {new Date(w.updated_at).toLocaleDateString()}
                      </span>
                      <span>↗</span>
                    </div>
                  </button>
                ))}
                <button
                  className="new-card"
                  onClick={() => (setError(""), setNewWorkspace(true))}
                >
                  <span>+</span>
                  <strong>Create a workspace</strong>
                  <p>A blank canvas for your next idea</p>
                </button>
              </div>
              {!workspaces.length && (
                <div className="welcome-note">
                  <span>✳</span>
                  <div>
                    <h3>Start with a little possibility.</h3>
                    <p>
                      Create an empty workspace, add a collection, then choose
                      how you want to see and use your data.
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR PERSISTENT WORKSPACE</span>
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
                {(["workspace", "data", "interface"] as const).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                  >
                    {t === "workspace"
                      ? "◫  Workspace"
                      : t === "data"
                        ? "▤  Collections & data"
                        : "⌘  Interface builder"}
                  </button>
                ))}
              </div>
              {tab === "workspace" &&
                (active.interface.nodes.length ? (
                  <InterfaceRenderer
                    key={`${active.id}-${epoch}`}
                    workspaceId={active.id}
                    definition={active.interface}
                    collections={collections}
                    report={report}
                  />
                ) : (
                  <section className="empty-state">
                    <div className="empty-symbol">◫</div>
                    <h2>A space that’s yours to shape.</h2>
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
                      Open interface builder ↗
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
                      <h2>Give your data a home.</h2>
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
              {tab === "interface" && (
                <section className="builder">
                  <div>
                    <h2>Shape your workspace</h2>
                    <p>
                      Add components, then save your interface. Saving or
                      removing components keeps your records intact.
                    </p>
                    <div className="builder-tools">
                      <button
                        onClick={() => {
                          try {
                            const d = JSON.parse(draft);
                            d.nodes.push({
                              id: `heading_${Date.now()}`,
                              type: "heading",
                              text: "My workspace",
                            });
                            setDraft(JSON.stringify(d, null, 2));
                          } catch {
                            setError("Fix the interface JSON first.");
                          }
                        }}
                      >
                        + Heading
                      </button>
                      {collections.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            try {
                              const d = JSON.parse(draft);
                              d.nodes.push(
                                {
                                  id: `form_${Date.now()}`,
                                  type: "form",
                                  collectionId: c.id,
                                },
                                {
                                  id: `table_${Date.now()}`,
                                  type: "table",
                                  collectionId: c.id,
                                },
                              );
                              setDraft(JSON.stringify(d, null, 2));
                            } catch {
                              setError("Fix the interface JSON first.");
                            }
                          }}
                        >
                          + {c.name} form & table
                        </button>
                      ))}
                    </div>
                    <label>
                      Interface definition
                      <textarea
                        className="code-editor"
                        spellCheck={false}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={18}
                      />
                    </label>
                    <div className="row">
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => run(() => save(JSON.parse(draft)))}
                      >
                        Save interface
                      </button>
                      <button
                        onClick={() =>
                          run(async () =>
                            setHistory(
                              await api(`workspaces/${active.id}/revisions`),
                            ),
                          )
                        }
                      >
                        Revision history
                      </button>
                      <button onClick={() => open(active.id)}>
                        Reload saved version
                      </button>
                    </div>
                    {history.length > 0 && (
                      <div className="history">
                        {history.map((r) => (
                          <div className="row" key={r.revision}>
                            <span>Revision {r.revision}</span>
                            <button
                              disabled={busy || r.revision === active.revision}
                              onClick={() => run(() => save(r.definition))}
                            >
                              Restore as new revision
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <aside className="builder-guide">
                    <span className="eyebrow">COMPONENT GUIDE</span>
                    <h3>
                      Simple pieces.
                      <br />
                      Endless arrangements.
                    </h3>
                    <p>
                      <strong>heading / text</strong>
                      <br />
                      Use “text” for the content.
                    </p>
                    <p>
                      <strong>form / table / list</strong>
                      <br />
                      Bind to a collection with “collectionId”. Forms use the
                      collection’s typed fields.
                    </p>
                    <p>
                      <strong>chart</strong>
                      <br />
                      Set “collectionId” and “field” to show value counts.
                    </p>
                    <p>
                      <strong>container / tabs</strong>
                      <br />
                      Nest components inside “children”.
                    </p>
                    <p>
                      <strong>button</strong>
                      <br />
                      Refreshes bound data. Set its “text” label.
                    </p>
                    <p>
                      Every component needs a unique “id”. Version is always 1.
                    </p>
                  </aside>
                </section>
              )}
            </>
          )}
        </main>
        <footer className="app-footer">
          PAW <span>Make room for possibility.</span>
          <span>Persistent Agentic Workspaces</span>
        </footer>
      </div>
      {newWorkspace && (
        <NameDialog
          error={error}
          title="A new place to begin."
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
              setDraft(JSON.stringify(w.interface, null, 2));
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
  return (
    <div className="brand">
      <span className="brand-mark">✳</span> paw
      <span className="brand-period">.</span>
    </div>
  );
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
        <h2>A home for your data.</h2>
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
