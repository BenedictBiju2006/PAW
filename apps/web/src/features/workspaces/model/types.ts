import type { Interface } from "../../interfaces/protocol/document";
export type Workspace = {
  id: string;
  name: string;
  interface: Interface;
  interfaceError?: string;
  legacySource?: unknown;
  revision: number;
  updated_at: string;
};
