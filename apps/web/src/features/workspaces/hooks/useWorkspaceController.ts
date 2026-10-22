"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../../../shared/http/api";
import { authenticate, getSession, signOut } from "../../auth/client";
import type { Collection } from "../../collections/public";
import type { Workspace } from "../model/types";
import { useWorkspaceViewport } from "./useWorkspaceViewport";
type Summary = Pick<Workspace, "id" | "name" | "revision" | "updated_at">;
export function useWorkspaceController(configured: boolean) {
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
  const [developer, setDeveloper] = useState(false);
  const [interfaceExpanded, setInterfaceExpanded] = useState(false);
  const [primaryView, setPrimaryView] = useState<"chat" | "interface">("chat");
  useEffect(() => {
    try {
      setDeveloper(localStorage.getItem("paw.developerTools") === "true");
    } catch {}
  }, []);
  useWorkspaceViewport();
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
    getSession()
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
      await signOut();
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
      const result = await authenticate(signup, form);
      if (result.authenticated) {
        const session = await getSession();
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

  const currentCollection = collections.find(
    (c) => c.id === selectedCollection,
  );
  return {
    configured,
    user,
    setUser,
    loading,
    setLoading,
    error,
    setError,
    notice,
    setNotice,
    busy,
    setBusy,
    workspaces,
    setWorkspaces,
    active,
    setActive,
    collections,
    setCollections,
    tab,
    setTab,
    developer,
    setDeveloper,
    interfaceExpanded,
    setInterfaceExpanded,
    primaryView,
    setPrimaryView,
    epoch,
    setEpoch,
    selectedCollection,
    setSelectedCollection,
    signup,
    setSignup,
    newWorkspace,
    setNewWorkspace,
    newCollection,
    setNewCollection,
    account,
    setAccount,
    renaming,
    setRenaming,
    report,
    run,
    refreshList,
    loadWorkspace,
    open,
    signout,
    auth,
    save,
    currentCollection,
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspaceController>;
