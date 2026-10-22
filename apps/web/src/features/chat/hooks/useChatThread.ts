"use client";
import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../shared/http/api";
import { useChatSessions } from "../components/ChatSessionProvider";
import { persistedMessages, type ChatMessage } from "../components/MessageView";
import type { Message } from "../model/schema";
import { useConversationDraft } from "./useConversationDraft";
export function useChatThread({
  drafts,
  workspaceId,
  conversationId,
  configured,
  refresh,
}: {
  drafts: Map<string, string>;
  workspaceId: string;
  conversationId: string;
  configured: boolean;
  refresh: () => void;
}) {
  const sessions = useChatSessions();
  const session = sessions.get(workspaceId, conversationId);
  const base = `workspaces/${workspaceId}/conversations/${conversationId}`;
  const [draft, setDraft] = useConversationDraft(conversationId, drafts);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [history, setHistory] = useState<Message[]>(session.history),
    [before, setBefore] = useState<number | null>(session.before),
    [turns, setTurns] = useState(session.turns);
  const historyRef = useRef<Message[]>(session.history);
  const submitting = useRef(false);
  const scroll = useRef<HTMLDivElement>(null),
    nearBottom = useRef(session.nearBottom),
    composer = useRef<HTMLTextAreaElement>(null),
    mounted = useRef(true),
    currentTurn = {
      get current() {
        return session.currentTurn;
      },
      set current(value: string | null) {
        session.currentTurn = value;
      },
    },
    lastRequest = {
      get current() {
        return session.lastRequest;
      },
      set current(value: import("../client/sessions").TurnRequest | null) {
        session.lastRequest = value;
      },
    };
  const load = useCallback(async () => {
    const r = await api<{ messages: Message[]; before: number | null }>(
      `${base}/messages?recent=true`,
    );
    if (!mounted.current) return;
    const preserveOlder =
      historyRef.current.length > 0 &&
      historyRef.current[0].sequence < (r.messages[0]?.sequence ?? Infinity);
    const combined = Array.from(
      new Map(
        [...historyRef.current, ...r.messages].map((message) => [
          message.id,
          message,
        ]),
      ).values(),
    ).sort((a, b) => a.sequence - b.sequence);
    historyRef.current = combined;
    setHistory(combined);
    session.history = combined;
    setBefore((previous) => (preserveOlder ? previous : r.before));
    if (!preserveOlder) session.before = r.before;
    if (!["submitted", "streaming"].includes(session.chat.status))
      setMessages(persistedMessages(combined));
    try {
      const t = await api<typeof turns>(`${base}/turns`);
      if (mounted.current) {
        setTurns(t);
        session.turns = t;
        if (!["submitted", "streaming"].includes(session.chat.status))
          setMessages(
            persistedMessages(
              combined,
              Object.fromEntries(t.map((turn) => [turn.id, turn.status])),
            ),
          );
      }
    } catch {}
  }, [base]);
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    error: transportError,
  } = useChat<ChatMessage>({ chat: session.chat });
  const running =
    status === "submitted" ||
    status === "streaming" ||
    turns.some((t) => t.status === "running");
  useEffect(() => {
    mounted.current = true;
    load()
      .catch((e) => mounted.current && setError(e.message))
      .finally(() => {
        if (mounted.current) {
          setLoading(false);
          setTimeout(() => composer.current?.focus(), 0);
        }
      });
    const unsubscribe = sessions.subscribe((event) => {
      if (event.workspaceId === workspaceId && event.kind === "conversation")
        setTimeout(() => {
          if (mounted.current) void load().catch((e) => setError(e.message));
        }, 0);
    });
    const poll = setInterval(() => {
      if (
        mounted.current &&
        !["submitted", "streaming"].includes(session.chat.status)
      )
        void load().catch(() => {});
    }, 2500);
    return () => {
      mounted.current = false;
      session.scrollTop = scroll.current?.scrollTop ?? session.scrollTop;
      session.nearBottom = nearBottom.current;
      unsubscribe();
      clearInterval(poll);
      // Navigation unsubscribes the view. Only Stop or page/session disposal
      // stops the externally managed AI SDK transport.
    };
  }, [load]);
  useEffect(() => {
    if (nearBottom.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages]);
  useEffect(() => {
    if (!loading && scroll.current && !session.nearBottom)
      scroll.current.scrollTop = session.scrollTop;
  }, [loading]);
  async function submit(initialText?: string) {
    const messageText = initialText ?? draft;
    if (!messageText.trim() || running || loading || submitting.current) return;
    submitting.current = true;
    const text = messageText.trim();
    setError("");
    if (!configured) {
      try {
        await api(`${base}/messages`, "POST", { text });
        setDraft("");
        sessions.notify({ workspaceId, kind: "conversation" });
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        submitting.current = false;
      }
      return;
    }
    const body = {
      turnId: crypto.randomUUID(),
      workspaceId,
      conversationId,
      text,
    };
    lastRequest.current = body;
    currentTurn.current = body.turnId;
    setDraft("");
    try {
      await sendMessage({ text }, { body });
    } finally {
      submitting.current = false;
    }
  }
  async function cancel() {
    const turnId =
      currentTurn.current ?? turns.find((t) => t.status === "running")?.id;
    if (turnId)
      await api("agent/cancel", "POST", {
        turnId,
        workspaceId,
        conversationId,
      }).catch((e) => setError(e.message));
    await stop();
    setTimeout(() => {
      if (mounted.current) void load().catch((e) => setError(e.message));
    }, 300);
  }

  async function loadOlder() {
    try {
      const el = scroll.current!,
        height = el.scrollHeight;
      const r = await api<{
        messages: Message[];
        before: number | null;
      }>(`${base}/messages?recent=true&before=${before}`);
      const combined = [...r.messages, ...history];
      historyRef.current = combined;
      nearBottom.current = false;
      setHistory(combined);
      session.history = combined;
      session.before = r.before;
      setBefore(r.before);
      setMessages(persistedMessages(combined));
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight - height;
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return {
    loadOlder,
    base,
    draft,
    setDraft,
    loading,
    setLoading,
    error: error || transportError?.message || "",
    setError,
    history,
    setHistory,
    before,
    setBefore,
    turns,
    setTurns,
    historyRef,
    submitting,
    scroll,
    session,
    nearBottom,
    composer,
    mounted,
    currentTurn,
    lastRequest,
    load,
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    running,
    submit,
    cancel,
  };
}
export type ChatThreadController = ReturnType<typeof useChatThread>;
