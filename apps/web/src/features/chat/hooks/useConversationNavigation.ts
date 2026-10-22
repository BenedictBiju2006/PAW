"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../shared/http/api";
import { useChatSessions } from "../components/ChatSessionProvider";
import type { Conversation } from "../model/schema";
export function useConversationNavigation(workspaceId: string | null) {
  const sessions = useChatSessions();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = useRef(workspaceId);
  current.current = workspaceId;
  const base = `workspaces/${workspaceId}/conversations`;
  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    const result = await api<{
      conversations: Conversation[];
      nextOffset: number | null;
    }>(`${base}?limit=100`);
    if (current.current !== workspaceId) return;
    setConversations((previous) =>
      [
        ...result.conversations,
        ...previous.filter(
          (c) =>
            c.workspace_id === workspaceId &&
            !result.conversations.some((r) => r.id === c.id),
        ),
      ].sort(
        (a, b) =>
          b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id),
      ),
    );
    setNext(result.nextOffset);
  }, [base, workspaceId]);
  useEffect(() => {
    setConversations([]);
    setNext(null);
    setError("");
    void refresh().catch(
      (e) => current.current === workspaceId && setError(e.message),
    );
    const unsubscribe = sessions.subscribe((event) => {
      if (event.workspaceId === workspaceId) void refresh().catch(() => {});
    });
    const poll = setInterval(() => {
      void refresh().catch(() => {});
    }, 3500);
    return () => {
      unsubscribe();
      clearInterval(poll);
    };
  }, [refresh, sessions, workspaceId]);
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    try {
      return await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create(text: string, configured: boolean) {
    const conversation = await api<Conversation>(base, "POST", {});
    void sessions
      .start(workspaceId!, conversation.id, text, configured)
      .catch(() =>
        sessions.notify({ workspaceId: workspaceId!, kind: "conversation" }),
      );
    if (current.current === workspaceId)
      setConversations((items) => [conversation, ...items]);
    return conversation;
  }
  async function rename(conversation: Conversation) {
    const title = prompt("Conversation title", conversation.title);
    if (!title?.trim()) return;
    await run(async () => {
      const result = await api<Conversation>(
        `${base}/${conversation.id}`,
        "PATCH",
        { title },
      );
      setConversations((items) =>
        items.map((c) => (c.id === result.id ? result : c)),
      );
    });
  }
  async function remove(conversation: Conversation) {
    if (
      !confirm(
        `Delete “${conversation.title}” and all its messages? This cannot be undone.`,
      )
    )
      return false;
    return !!(await run(async () => {
      await api(`${base}/${conversation.id}`, "DELETE", { confirmed: true });
      setConversations((items) =>
        items.filter((c) => c.id !== conversation.id),
      );
      return true;
    }));
  }
  async function more() {
    if (next === null) return;
    await run(async () => {
      const result = await api<{
        conversations: Conversation[];
        nextOffset: number | null;
      }>(`${base}?offset=${next}&limit=100`);
      setConversations((items) => [
        ...items,
        ...result.conversations.filter(
          (c) => !items.some((i) => i.id === c.id),
        ),
      ]);
      setNext(result.nextOffset);
    });
  }
  return {
    conversations: conversations.filter((c) => c.workspace_id === workspaceId),
    next,
    error,
    busy,
    refresh,
    create,
    rename,
    remove,
    more,
    sessions,
  };
}
export type ConversationNavigation = ReturnType<
  typeof useConversationNavigation
>;
