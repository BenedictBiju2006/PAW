"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../shared/http/api";
import { authenticate, getSession, signOut } from "../../auth/client";
import { useChatSessions, useConversationNavigation } from "../../chat/client";
import {
  defaultDestination,
  destinationFromUrl,
  workspaceUrl,
  type WorkspaceDestination,
} from "../model/navigation";
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
  const [destination, setDestination] = useState<WorkspaceDestination>({
    kind: "new-chat",
  });
  const [newChatVersion, setNewChatVersion] = useState(0);
  const sessions = useChatSessions();
  const conversations = useConversationNavigation(active?.id ?? null);
  const loadSequence = useRef(0);
  const activeId = useRef(active?.id);
  activeId.current = active?.id;
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
            if (requested)
              await loadWorkspace(
                requested,
                destinationFromUrl(new URLSearchParams(window.location.search)),
              );
          }
        }
      })
      .catch((e) => current && setError(e.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [configured]);
  async function loadWorkspace(id: string, requested?: WorkspaceDestination) {
    const sequence = ++loadSequence.current;
    const [workspace, items] = await Promise.all([
      api<Workspace>(`workspaces/${id}`),
      api<Collection[]>(`workspaces/${id}/collections`),
    ]);
    if (sequence !== loadSequence.current) return;
    let target = requested ?? defaultDestination(workspace);
    if (target.kind === "conversation") {
      try {
        await api(`workspaces/${id}/conversations/${target.conversationId}`);
      } catch (e) {
        target = { kind: "new-chat" };
        setError((e as Error).message);
      }
    }
    if (sequence !== loadSequence.current) return;
    setActive(workspace);
    setDestination(target);
    setDeveloper(false);
    setCollections(items);
    setSelectedCollection(items[0]?.id ?? "");
    setTab("workspace");
    setEpoch((e) => e + 1);
  }
  async function open(id: string) {
    await run(async () => {
      await loadWorkspace(id);
      window.history.pushState(null, "", `/?workspace=${id}`);
    });
  }
  async function signout() {
    await run(async () => {
      await signOut();
      sessions.reset();
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
  function navigate(target: WorkspaceDestination) {
    if (!active) return;
    const id = active.id;
    void run(async () => {
      if (
        target.kind === "conversation" &&
        !conversations.conversations.some((c) => c.id === target.conversationId)
      )
        await api(`workspaces/${id}/conversations/${target.conversationId}`);
      if (target.kind === "interface") await refreshWorkspace(id);
      if (activeId.current !== id) return;
      setDestination(target);
      setDeveloper(false);
      window.history.pushState(null, "", workspaceUrl(id, target));
    });
  }
  function newChat() {
    if (active) sessions.drafts.delete(`${active.id}:new`);
    setNewChatVersion((v) => v + 1);
    navigate({ kind: "new-chat" });
  }
  function overview() {
    ++loadSequence.current;
    setActive(null);
    setDeveloper(false);
    window.history.pushState(null, "", "/");
  }
  const refreshWorkspace = useCallback(async (id: string) => {
    const [workspace, items] = await Promise.all([
      api<Workspace>(`workspaces/${id}`),
      api<Collection[]>(`workspaces/${id}/collections`),
    ]);
    if (activeId.current !== id) return;
    setActive(workspace);
    setCollections(items);
    setSelectedCollection((current) =>
      items.some((c) => c.id === current) ? current : (items[0]?.id ?? ""),
    );
    setEpoch((e) => e + 1);
  }, []);
  useEffect(
    () =>
      sessions.subscribe((event) => {
        if (event.kind === "mutation" && event.workspaceId === activeId.current)
          void refreshWorkspace(event.workspaceId).catch((e) =>
            setError(e.message),
          );
      }),
    [sessions, refreshWorkspace],
  );
  useEffect(() => {
    if (!user) return;
    const pop = () => {
      const params = new URLSearchParams(location.search);
      const id = params.get("workspace");
      if (id) void run(() => loadWorkspace(id, destinationFromUrl(params)));
      else {
        ++loadSequence.current;
        setActive(null);
        setDeveloper(false);
      }
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [!!user]);
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
    destination,
    navigate,
    newChat,
    newChatVersion,
    overview,
    conversations,
    refreshWorkspace,
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
