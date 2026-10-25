import "server-only";
import { z } from "zod";
import type { ToolRegistry } from "./registry";
import type {
  Permission,
  ToolContext,
  ToolMetadata,
  ToolPolicy,
} from "./types";
export function registrar<Services>(registry: ToolRegistry<Services>) {
  function add<S extends z.ZodObject>(
    id: string,
    description: string,
    purpose: string,
    keywords: string[],
    schema: S,
    result: string,
    handler: (
      args: z.infer<S>,
      context: ToolContext<Services>,
    ) => Promise<unknown>,
    permission: Permission = "read",
    policy: ToolPolicy = {},
  ) {
    const metadata: ToolMetadata = {
      id,
      name: id,
      description,
      purpose,
      keywords,
      result,
      requiredPermissions: [permission],
      sideEffects:
        permission === "read"
          ? "none"
          : permission === "delete"
            ? "destructive"
            : "write",
    };
    registry.register(metadata, schema, handler, {
      reuse: permission === "read" ? "resource" : undefined,
      ...policy,
    });
  }
  return add;
}
