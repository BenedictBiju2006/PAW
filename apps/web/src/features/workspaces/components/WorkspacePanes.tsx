"use client";
import dynamic from "next/dynamic";
import { api } from "../../../shared/http/api";
import Chat from "../../chat/client";
import type { Collection } from "../../collections/public";
import { isEmptyInterface } from "../../interfaces/public";
import type { WorkspaceController } from "../hooks/useWorkspaceController";
import type { Workspace } from "../model/types";
const InterfaceRenderer = dynamic(() => import("../../interfaces/client"), {
  ssr: false,
});
export function WorkspacePanes({ model }: { model: WorkspaceController }) {
  const {
    setError,
    active,
    setActive,
    collections,
    setCollections,
    developer,
    setDeveloper,
    interfaceExpanded,
    setInterfaceExpanded,
    primaryView,
    setPrimaryView,
    epoch,
    setEpoch,
    setSelectedCollection,
    report,
  } = model;
  if (!active) return null;
  return (
    <>
      <div className="primary-view-switch tabs" aria-label="Primary view">
        <button
          aria-pressed={
            !developer && !interfaceExpanded && primaryView === "chat"
          }
          onClick={() => {
            setPrimaryView("chat");
            setInterfaceExpanded(false);
            setDeveloper(false);
          }}
        >
          Chat
        </button>
        <button
          aria-pressed={
            !developer && (interfaceExpanded || primaryView === "interface")
          }
          onClick={() => {
            setPrimaryView("interface");
            setDeveloper(false);
          }}
        >
          Interface
        </button>
      </div>
      <div
        hidden={developer}
        className={`workspace-panes showing-${primaryView} ${interfaceExpanded ? "interface-expanded" : ""}`}
      >
        <div className="primary-chat">
          <Chat
            key={active.id}
            workspaceId={active.id}
            refresh={() => {
              void Promise.all([
                api<Workspace>(`workspaces/${active.id}`),
                api<Collection[]>(`workspaces/${active.id}/collections`),
              ])
                .then(([workspace, items]) => {
                  setActive(workspace);
                  setCollections(items);
                  setSelectedCollection((current) =>
                    items.some((c) => c.id === current)
                      ? current
                      : (items[0]?.id ?? ""),
                  );
                  setEpoch((e) => e + 1);
                })
                .catch((e) => setError(e.message));
            }}
          />
        </div>
        <section className="primary-interface" aria-label="Live interface">
          <div className="interface-heading">
            <h2>Interface</h2>
            <button
              aria-expanded={interfaceExpanded}
              aria-controls="live-interface-content"
              onClick={() => {
                setInterfaceExpanded((value) => !value);
                setPrimaryView("interface");
              }}
            >
              {interfaceExpanded ? "Restore interface" : "Expand interface"}
            </button>
          </div>
          <div className="interface-content" id="live-interface-content">
            {active.interfaceError ? (
              <div className="error" role="alert">
                {active.interfaceError} Open Interface Builder to recover the
                original definition.
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
                <h2>Your interface will appear here.</h2>
                <p>Describe what you want to create in Chat.</p>
              </section>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
