"use client";
import { api } from "../../../shared/http/api";
import { CollectionDialog, type Collection } from "../../collections/client";
import type { WorkspaceController } from "../hooks/useWorkspaceController";
import type { Workspace } from "../model/types";
import { NameDialog } from "./NameDialog";
export function WorkspaceDialogs({ model }: { model: WorkspaceController }) {
  const {
    newWorkspace,
    error,
    busy,
    setNewWorkspace,
    run,
    refreshList,
    setActive,
    setCollections,
    setSelectedCollection,
    setTab,
    renaming,
    active,
    setRenaming,
    newCollection,
    setNewCollection,
    collections,
  } = model;
  return (
    <>
      {" "}
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
    </>
  );
}
