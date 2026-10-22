"use client";
import { useState } from "react";
/** Scoped to the mounted workspace; drafts never enter persistent storage. */
export function useConversationDraft(id: string, drafts: Map<string, string>) {
  const [draft, update] = useState(() => drafts.get(id) ?? "");
  function setDraft(value: string) {
    drafts.set(id, value);
    update(value);
  }
  return [draft, setDraft] as const;
}
