import "server-only";
import { z } from "zod";
import { registerCollectionsTools } from "../features/collections/server/public";
import { registerInterfacesTools } from "../features/interfaces/server/public";
import {
  registrar,
  ToolRegistry,
  ToolExecutor,
  ToolGuidanceError,
} from "../features/tooling/server/public";
import { registerWorkspacesTools } from "../features/workspaces/server/public";
import { ServiceError } from "../shared/db/result";
import {
  inspectResource,
  listResources,
  resourceListSchema,
} from "./resources";
import type { WorkspaceServices } from "./services";
export function createToolRegistry() {
  const registry = new ToolRegistry<WorkspaceServices>(
    async (args, id, context) => {
      if (context.workspaceId) {
        await context.service.workspace(context.workspaceId);
        if (args.workspaceId && args.workspaceId !== context.workspaceId)
          return {
            ok: false as const,
            error: {
              code: "forbidden",
              message: "Tool targets a different workspace.",
              guidance: "Use the current workspace identity.",
            },
          };
        if (id === "create_workspace")
          return {
            ok: false as const,
            error: {
              code: "forbidden",
              message:
                "Cannot create workspaces in a workspace-scoped session.",
              guidance: "Use an account-scoped session.",
            },
          };
      }
    },
  );
  const add = registrar(registry);
  add(
    "search_tools",
    "Search available capabilities without loading full schemas.",
    "Discover relevant tools by task and intent.",
    ["discovery", "capabilities"],
    z
      .object({
        query: z.string().max(500),
        limit: z.number().int().min(1).max(30).default(10),
      })
      .strict(),
    "Array of compact tool summaries.",
    async (a, c) => {
      const executor = new ToolExecutor(registry, c);
      const candidates = registry.search(a.query, registry.summaries().length);
      const accessible = await Promise.all(
        candidates.map(async (tool) =>
          (await executor.discoveryAccess(tool.id)) ? null : tool,
        ),
      );
      return accessible.filter((tool) => tool !== null).slice(0, a.limit);
    },
  );
  add(
    "describe_tool",
    "Retrieve a tool's complete schema and permission requirements.",
    "Learn arguments, results, use cases and side effects before invocation.",
    ["schema", "discovery"],
    z.object({ toolId: z.string().max(100) }).strict(),
    "Tool metadata, JSON input/output schemas and result description.",
    async (a, c) => {
      if (!registry.resolve(a.toolId))
        throw new ServiceError("Unknown tool identifier.", 404);
      const denied = await new ToolExecutor(registry, c).discoveryAccess(
        a.toolId,
      );
      if (denied) throw new ToolGuidanceError(denied.error, 403);
      return registry.describe(a.toolId);
    },
  );
  add(
    "list_resources",
    "List accessible resource metadata with bounded pagination.",
    "Explore workspaces, collections, schemas, records, interfaces, components, catalog and revisions.",
    ["discovery", "resources", "explore"],
    resourceListSchema,
    "{items: Resource[], nextOffset: number|null}; use inspect_resource for details.",
    listResources,
  );
  add(
    "inspect_resource",
    "Read an existing authorized paw:// resource. For UI component types, schemas and examples use search_ui_components or inspect_component; describe_tool is still required before invoking a capability.",
    "Progressively learn schemas, properties, relationships and supported operations.",
    ["discovery", "resources", "schema"],
    z.object({ uri: z.string().max(500) }).strict(),
    "Resource details, relationships and operation identifiers.",
    async (a, c) => inspectResource(a.uri, c),
  );
  registerWorkspacesTools(registry, inspectResource);
  registerCollectionsTools(registry);
  registerInterfacesTools(registry);
  return registry;
}
