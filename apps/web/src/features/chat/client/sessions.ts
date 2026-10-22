"use client";
import { api } from "../../../shared/http/api";
import { Chat } from "@ai-sdk/react";
import { transport } from "./transport";
import type { ChatMessage } from "../components/MessageView";
import type { Message } from "../model/schema";
export type SessionChange = {
  workspaceId: string;
  kind: "mutation" | "conversation";
};
export type TurnRequest = {
  turnId: string;
  workspaceId: string;
  conversationId: string;
  text: string;
};
export type TurnStatus = {
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
};
export class ConversationSession {
  readonly chat: Chat<ChatMessage>;
  currentTurn: string | null = null;
  lastRequest: TurnRequest | null = null;
  history: Message[] = [];
  before: number | null = null;
  turns: TurnStatus[] = [];
  scrollTop = 0;
  nearBottom = true;
  constructor(
    readonly workspaceId: string,
    readonly conversationId: string,
    notify: (event: SessionChange) => void,
  ) {
    this.chat = new Chat<ChatMessage>({
      id: conversationId,
      transport,
      onData: (part) => {
        if (part.type === "data-mutation")
          notify({ workspaceId, kind: "mutation" });
        if (part.type === "data-conversation")
          notify({ workspaceId, kind: "conversation" });
      },
      onFinish: () => {
        this.currentTurn = null;
        notify({ workspaceId, kind: "conversation" });
        notify({ workspaceId, kind: "mutation" });
      },
      onError: () => notify({ workspaceId, kind: "conversation" }),
    });
  }
}
/** Authenticated page lifetime, independent of which thread React displays. */
export class ChatSessions {
  private sessions = new Map<string, ConversationSession>();
  private listeners = new Set<(event: SessionChange) => void>();
  readonly drafts = new Map<string, string>();

  get(workspaceId: string, conversationId: string) {
    const key = `${workspaceId}:${conversationId}`;
    let session = this.sessions.get(key);
    if (!session) {
      session = new ConversationSession(workspaceId, conversationId, (event) =>
        this.notify(event),
      );
      this.sessions.set(key, session);
    }
    return session;
  }
  async start(
    workspaceId: string,
    conversationId: string,
    text: string,
    configured: boolean,
  ) {
    const session = this.get(workspaceId, conversationId);
    if (configured) {
      const body = {
        turnId: crypto.randomUUID(),
        workspaceId,
        conversationId,
        text,
      };
      session.lastRequest = body;
      session.currentTurn = body.turnId;
      await session.chat.sendMessage({ text }, { body });
    } else {
      await api(
        `workspaces/${workspaceId}/conversations/${conversationId}/messages`,
        "POST",
        { text },
      );
      this.notify({ workspaceId, kind: "conversation" });
    }
  }
  subscribe(listener: (event: SessionChange) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  notify(event: SessionChange) {
    for (const listener of this.listeners) listener(event);
  }
  reset() {
    for (const session of this.sessions.values()) void session.chat.stop();
    this.sessions.clear();
    this.drafts.clear();
  }
}
