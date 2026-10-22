"use client";
import { DataView } from "../../collections/client";
import { InterfaceBuilder } from "../../interfaces/client";
import type { WorkspaceController } from "../hooks/useWorkspaceController";
export function DeveloperTools({ model }: { model: WorkspaceController }) {
  const {
    setError,
    busy,
    active,
    collections,
    tab,
    setTab,
    developer,
    epoch,
    selectedCollection,
    setSelectedCollection,
    setNewCollection,
    report,
    open,
    save,
    currentCollection,
  } = model;
  if (!active) return null;
  return (
    <section
      className="developer-panel"
      id="developer-panel"
      hidden={!developer}
      aria-label="Developer Tools"
    >
      <p className="muted">
        Workspace {active.id} · {collections.length} collections · Interface
        revision {active.revision}
      </p>
      <div className="tabs" role="tablist" aria-label="Developer views">
        <button
          role="tab"
          aria-selected={tab !== "interface"}
          onClick={() => setTab("data")}
        >
          Collections &amp; data
        </button>
        <button
          role="tab"
          aria-selected={tab === "interface"}
          onClick={() => setTab("interface")}
        >
          Interface builder
        </button>
      </div>
      {tab !== "interface" && (
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
            <button onClick={() => (setError(""), setNewCollection(true))}>
              + New collection
            </button>
          </div>
          {currentCollection ? (
            <>
              <details className="schema-details">
                <summary>
                  Collection schema · {currentCollection.fields.length} fields
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
              <p>A collection defines the fields your records can hold.</p>
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
        <InterfaceBuilder
          workspace={active}
          collections={collections}
          busy={busy}
          save={save}
          reload={() => open(active.id)}
        />
      )}
    </section>
  );
}
