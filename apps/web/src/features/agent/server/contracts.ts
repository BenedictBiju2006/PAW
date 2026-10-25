import type { AgentStore } from "./store";
export type Store = Pick<AgentStore, "event" | "finish"> &
  Partial<Pick<AgentStore, "diagnostics" | "modelRequest">>;
