import type { z } from "zod";
export type Permission = "read" | "write" | "delete";
export type ToolContext<Services = unknown> = {
  service: Services;
  /** Server-selected scope, never sourced from model arguments. */
  workspaceId?: string;
  permissions: ReadonlySet<Permission>;
  /** Trusted host callback: obtain real user approval for these exact arguments.
   * Never populate this from a tool argument, model output, or HTTP Boolean. */
  authorizeDestructive?: (
    toolId: string,
    args: Readonly<Record<string, unknown>>,
  ) => Promise<boolean>;
};
export type ToolMetadata = {
  id: string;
  name: string;
  description: string;
  purpose: string;
  keywords: string[];
  requiredPermissions: Permission[];
  sideEffects: "none" | "write" | "destructive";
  result: string;
};
export type ToolDefinition<Services = unknown> = ToolMetadata & {
  inputSchema: z.ZodObject;
  handler: (args: Record<string, unknown>, context: ToolContext<Services>) => Promise<unknown>;
};
export type ToolResult =
  | { ok: true; data: unknown }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        guidance: string;
        issues?: unknown;
      };
    };
