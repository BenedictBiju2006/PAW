import { z } from "zod";
import { ServiceError } from "../shared/db/result";
import { ToolRegistry } from "../features/tooling/server/registry";
import { registrar } from "../features/tooling/server/register";
import { registerWorkspacesTools } from "../features/workspaces/server/tools";
import { registerCollectionsTools } from "../features/collections/server/tools";
import { registerInterfacesTools } from "../features/interfaces/server/tools";
import { inspectResource,listResources,resourceListSchema } from "./resources";
import type { WorkspaceServices } from "./services";
export function createToolRegistry() {
const registry=new ToolRegistry<WorkspaceServices>(async (args,id,context)=>{
if(context.workspaceId){
await context.service.workspace(context.workspaceId);
if(args.workspaceId && args.workspaceId!==context.workspaceId) throw new ServiceError("Tool targets a different workspace.",403);
if(id==="create_workspace") throw new ServiceError("Cannot create workspaces in a workspace-scoped session.",403);
}
});
const add=registrar(registry);
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
    async (a) => registry.search(a.query, a.limit),
  );
add(
    "describe_tool",
    "Retrieve a tool's complete schema and permission requirements.",
    "Learn arguments, results, use cases and side effects before invocation.",
    ["schema", "discovery"],
    z.object({ toolId: z.string().max(100) }).strict(),
    "Tool metadata, JSON input/output schemas and result description.",
    async (a) => {
      if (!registry.resolve(a.toolId))
        throw new ServiceError("Unknown tool identifier.", 404);
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
    "Inspect an authorized paw:// resource identifier.",
    "Progressively learn schemas, properties, relationships and supported operations.",
    ["discovery", "resources", "schema"],
    z.object({ uri: z.string().max(500) }).strict(),
    "Resource details, relationships and operation identifiers.",
    async (a, c) => inspectResource(a.uri, c),
  );
registerWorkspacesTools(registry,inspectResource);
registerCollectionsTools(registry);
registerInterfacesTools(registry);
return registry;
}
