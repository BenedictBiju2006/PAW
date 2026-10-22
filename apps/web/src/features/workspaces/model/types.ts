import type { Interface } from "../../interfaces/public";
export type Workspace = {
  id: string;
  name: string;
  interface: Interface;
  interfaceError?: string;
  legacySource?: unknown;
  revision: number;
  updated_at: string;
};
