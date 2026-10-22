"use client";
import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../shared/http/api";
import { transport } from "../client/transport";
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
  const base = `workspaces/${workspaceId}/conversations/${conversationId}`;
  const [draft, setDraft] = useConversationDraft(conversationId, drafts);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [history, setHistory] = useState<Message[]>([]),
    [before, setBefore] = useState<number | null>(null),
    [turns, setTurns] = useState<
      {
        id: string;
        status: string;
        notice: string;
        input_tokens: number;
        output_tokens: number;
        provider: string;
        model: string;
        model_requests: number;
        tool_calls: number;
        cached_input_tokens: number | null;
      }[]
    >([]);
  const historyRef = useRef<Message[]>([]);
  const submitting = useRef(false);
  const scroll = useRef<HTMLDivElement>(null),
    nearBottom = useRef(true),
    composer = useRef<HTMLTextAreaElement>(null),
    mounted = useRef(true),
    currentTurn = useRef<string | null>(null),
    lastRequest = useRef<{
      turnId: string;
      workspaceId: string;
      conversationId: string;
      text: string;
    } | null>(null);
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
    setBefore((previous) => (preserveOlder ? previous : r.before));
    setMessages(persistedMessages(combined));
    try {
      const t = await api<typeof turns>(`${base}/turns`);
      if (mounted.current) {
        setTurns(t);
        setMessages(
          persistedMessages(
            combined,
            Object.fromEntries(t.map((turn) => [turn.id, turn.status])),
          ),
        );
      }
    } catch {}
  }, [base]);
  const { messages, setMessages, sendMessage, status, stop } =
    useChat<ChatMessage>({
      id: conversationId,
      transport,
      onData: (part) => {
        if (mounted.current && part.type === "data-mutation") refresh();
      },
      onFinish: () => {
        if (!mounted.current) return;
        currentTurn.current = null;
        void load().catch((e) => mounted.current && setError(e.message));
        refresh();
      },
      onError: (e) => {
        if (!mounted.current) return;
        setError(
          e.message ||
            "Response interrupted. Reload saved messages before retrying.",
        );
      },
    });
  const running = status === "submitted" || status === "streaming";
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
    return () => {
      mounted.current = false;
      void stop();
      if (currentTurn.current)
        void api("agent/cancel", "POST", {
          turnId: currentTurn.current,
          workspaceId,
          conversationId,
        }).catch(() => {});
    };
  }, [load]);
  useEffect(() => {
    if (nearBottom.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages]);
  async function submit() {
    if (!draft.trim() || running || loading || submitting.current) return;
    submitting.current = true;
    const text = draft.trim();
    setError("");
    if (!configured) {
      try {
        await api(`${base}/messages`, "POST", { text });
        setDraft("");
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
    const turnId = currentTurn.current;
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
    error,
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
