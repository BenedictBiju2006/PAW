"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../shared/http/api";
import type { Collection } from "../../collections/public";
import type { Workspace } from "../../workspaces/public";
import { catalogDocument } from "../protocol/catalog";
import {
  appendComponents,
  parseInterface,
  validateBindings,
  type Interface,
} from "../protocol/document";
import { upgradeInterface } from "../protocol/legacy";
const Runtime = dynamic(() => import("./A2UIRuntime"), { ssr: false });
export default function InterfaceBuilder({
  workspace,
  collections,
  save,
  reload,
  busy,
}: {
  workspace: Workspace;
  collections: Collection[];
  save: (definition: Interface) => Promise<void>;
  reload: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(() =>
    JSON.stringify(workspace.legacySource ?? workspace.interface, null, 2),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<
    { revision: number; definition: unknown }[]
  >([]);
  useEffect(() => {
    setDraft(
      JSON.stringify(workspace.legacySource ?? workspace.interface, null, 2),
    );
    setHistory([]);
  }, [workspace.id, workspace.revision]);
  const validation = useMemo(() => {
    try {
      const definition = parseInterface(JSON.parse(draft));
      validateBindings(definition, collections);
      return { definition, error: "" };
    } catch (error) {
      return { definition: null, error: (error as Error).message };
    }
  }, [draft, collections]);
  function append(components: Parameters<typeof appendComponents>[1]) {
    try {
      setDraft(
        JSON.stringify(
          appendComponents(parseInterface(JSON.parse(draft)), components),
          null,
          2,
        ),
      );
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function action(callback: () => Promise<void>) {
    setError("");
    setPending(true);
    try {
      await callback();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="interface-builder">
      <div className="builder-header">
        <div>
          <h2>Interface Builder</h2>
          <p>
            A2UI v0.9.1 messages. Preview is read-only; use the Interface pane
            for persistent changes.
          </p>
        </div>
        <div className="row">
          <button
            disabled={busy || pending || !validation.definition}
            className="primary"
            onClick={() =>
              action(async () => {
                if (validation.definition) await save(validation.definition);
              })
            }
          >
            Save interface
          </button>
          <button disabled={busy || pending} onClick={reload}>
            Reload saved
          </button>
        </div>
      </div>
      {workspace.interfaceError && (
        <div className="error" role="alert">
          {workspace.interfaceError} The original JSON is shown below for
          recovery.
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="builder-tools">
        <button
          onClick={() =>
            append([
              {
                id: `heading_${Date.now()}`,
                component: "Text",
                text: "My workspace",
                variant: "h2",
              },
            ])
          }
        >
          Add heading
        </button>
        {collections.map((c) => (
          <span className="row" key={c.id}>
            <button
              onClick={() =>
                append([
                  {
                    id: `form_${Date.now()}`,
                    component: "CollectionForm",
                    collectionId: c.id,
                  },
                  {
                    id: `table_${Date.now()}`,
                    component: "DataTable",
                    collectionId: c.id,
                  },
                ])
              }
            >
              Add {c.name} form & table
            </button>
            <button
              onClick={() =>
                append([
                  {
                    id: `chart_${Date.now()}`,
                    component: "CollectionChart",
                    collectionId: c.id,
                    field: c.fields[0].key,
                  },
                ])
              }
            >
              Add {c.name} chart
            </button>
          </span>
        ))}
      </div>
      <div className="editor-preview">
        <div>
          <label htmlFor="interface-json">A2UI messages</label>
          <textarea
            id="interface-json"
            className="code-editor"
            value={draft}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            rows={28}
            aria-invalid={Boolean(validation.error)}
            aria-describedby="interface-validation"
          />
          <p
            id="interface-validation"
            className={validation.error ? "validation-error" : "muted"}
            role={validation.error ? "alert" : "status"}
          >
            {validation.error ||
              "Valid A2UI protocol, catalog, references, and workspace bindings."}
          </p>
        </div>
        <section className="preview" aria-label="Interface preview">
          <h3>Preview</h3>
          {validation.definition ? (
            <Runtime
              definition={validation.definition}
              workspaceId={workspace.id}
              collections={collections}
              report={setError}
              preview
            />
          ) : (
            <p>Fix the validation errors to preview this definition.</p>
          )}
        </section>
      </div>
      <div className="builder-history">
        <button
          onClick={() =>
            action(async () =>
              setHistory(await api(`workspaces/${workspace.id}/revisions`)),
            )
          }
        >
          Revision history
        </button>
        {history.map((revision) => (
          <div className="history-row" key={revision.revision}>
            <span>Revision {revision.revision}</span>
            <button
              disabled={
                busy || pending || revision.revision === workspace.revision
              }
              onClick={() =>
                action(async () => {
                  await save(upgradeInterface(revision.definition));
                  setHistory([]);
                })
              }
            >
              Restore as new revision
            </button>
            <details>
              <summary>Original definition</summary>
              <pre>{JSON.stringify(revision.definition, null, 2)}</pre>
            </details>
          </div>
        ))}
      </div>
      <details className="catalog-reference">
        <summary>PAW component catalog and actions</summary>
        <p>
          Standard A2UI Text, Row, Column, Card, Button, TextField, CheckBox,
          Tabs, List, and Divider. PAW adds CollectionForm, DataTable, and
          CollectionChart. Bind strings with {`{"path":"/field"}`}; component
          children reference IDs. Only paw.refresh and paw.createRecord events
          are allowed. Persistent records stay in collections.
        </p>
        <pre>{JSON.stringify(catalogDocument(), null, 2)}</pre>
      </details>
    </section>
  );
}
