"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ChatSessions } from "../client/sessions";
const Context = createContext<ChatSessions | null>(null);
export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const [sessions] = useState(() => new ChatSessions());
  useEffect(() => () => sessions.reset(), [sessions]);
  return <Context.Provider value={sessions}>{children}</Context.Provider>;
}
export function useChatSessions() {
  const value = useContext(Context);
  if (!value) throw new Error("ChatSessionProvider is required");
  return value;
}
