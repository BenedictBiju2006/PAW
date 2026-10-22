"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../shared/http/api";
import type { AIStatus } from "../../providers/public";
import type { Conversation } from "../model/schema";
export function useConversationNavigation(workspaceId: string) {
  const drafts = useRef(new Map<string, string>()).current;
  const base = `workspaces/${workspaceId}/conversations`;
  const navigationToggle = useRef<HTMLButtonElement>(null);
  const navigationPanel = useRef<HTMLElement>(null);
  function closeDrawer() {
    setDrawer(false);
    navigationToggle.current?.focus();
  }
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [next, setNext] = useState<number | null>(null),
    [active, setActive] = useState<Conversation | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [status, setStatus] = useState<AIStatus | null>(null),
    [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (drawer)
      navigationPanel.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus();
  }, [drawer]);
  useEffect(() => {
    let current = true;
    api<{ conversations: Conversation[]; nextOffset: number | null }>(base)
      .then((r) => {
        if (current) {
          setConversations(r.conversations);
          setNext(r.nextOffset);
          setActive(r.conversations.at(-1) ?? null);
        }
      })
      .catch((e) => current && setError(e.message));
    api<AIStatus>("ai-settings")
      .then((s) => current && setStatus(s))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [base]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return {
    drafts,
    base,
    navigationToggle,
    navigationPanel,
    closeDrawer,
    conversations,
    setConversations,
    next,
    setNext,
    active,
    setActive,
    error,
    setError,
    busy,
    setBusy,
    settings,
    setSettings,
    status,
    setStatus,
    drawer,
    setDrawer,
    run,
  };
}
export type ConversationNavigation = ReturnType<
  typeof useConversationNavigation
>;
