import { z } from "zod";
import type { ToolContext, Permission, ToolMetadata } from "./types";
import type { ToolRegistry } from "./registry";
export function registrar<Services>(registry:ToolRegistry<Services>) {
function add<S extends z.ZodObject>(
    id: string,
    description: string,
    purpose: string,
    keywords: string[],
    schema: S,
    result: string,
    handler: (args: z.infer<S>, context: ToolContext<Services>) => Promise<unknown>,
    permission: Permission = "read",
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
    registry.register(metadata, schema, handler);
  }
return add;
}
