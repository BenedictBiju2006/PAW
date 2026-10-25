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
  async function batchDescribe(
    ids: string[],
    context: import("../features/tooling/public").ToolContext<WorkspaceServices>,
  ) {
    const executor = new ToolExecutor(registry, context);
    const tools: ReturnType<typeof registry.compactDescription>[] = [];
    const unavailable: string[] = [],
      deferred: string[] = [];
    for (const id of [...new Set(ids)]) {
      if (await executor.discoveryAccess(id)) {
        unavailable.push(id);
        continue;
      }
      if (tools.length >= 6) {
        deferred.push(id);
        continue;
      }
      const tool = registry.compactDescription(id);
      if (JSON.stringify([...tools, tool]).length > 16000) {
        deferred.push(id);
        continue;
      }
      tools.push(tool);
    }
    return {
      tools,
      ...(unavailable.length ? { unavailable } : {}),
      ...(deferred.length ? { deferred } : {}),
      guidance:
        "Only returned schemas are disclosed. Invoke these tools directly with validated arguments; replace example IDs with verified resource IDs. Batch independent calls in one response.",
    };
  }
  add(
    "search_tools",
    "Search available capabilities without loading full schemas.",
    "Discover relevant tools by task and intent.",
    ["discovery", "capabilities"],
    z
      .object({
        query: z.string().max(500).optional(),
        queries: z
          .array(z.string().min(1).max(500))
          .min(1)
          .max(4)
          .optional()
          .describe(
            "Search several related capabilities together; provide query or queries. Schema discovery needs a focused nonempty query.",
          ),
        includeSchemas: z
          .boolean()
          .optional()
          .describe(
            "Return up to six compact, authoritative schemas with examples. These authorize invocation in this turn without another describe call.",
          ),
        limit: z.number().int().min(1).max(30).default(10),
      })
      .strict()
      .superRefine((value, ctx) => {
        if (value.query === undefined && !value.queries)
          ctx.addIssue({
            code: "custom",
            message: "Provide query or queries.",
          });
        if (
          value.includeSchemas &&
          !value.query?.trim() &&
          !value.queries?.some((query) => query.trim())
        )
          ctx.addIssue({
            code: "custom",
            message: "Schema discovery requires a focused query.",
          });
      }),
    "Array of compact tool summaries.",
    async (a, c) => {
      const executor = new ToolExecutor(registry, c);
      const queries = [
        ...(a.query === undefined ? [] : [a.query]),
        ...(a.queries ?? []),
      ];
      const matches = queries.map((query) =>
        registry.search(query, registry.summaries().length),
      );
      const candidates = new Map<
        string,
        ReturnType<typeof registry.search>[number]
      >();
      for (let rank = 0; rank < registry.summaries().length; rank++)
        for (const group of matches)
          if (group[rank]) candidates.set(group[rank].id, group[rank]);
      const accessible = await Promise.all(
        [...candidates.values()].map(async (tool) =>
          (await executor.discoveryAccess(tool.id)) ? null : tool,
        ),
      );
      const selected = accessible
        .filter((tool) => tool !== null)
        .slice(0, a.limit);
      return a.includeSchemas
        ? batchDescribe(
            selected.map((tool) => tool.id),
            c,
          )
        : selected;
    },
    "read",
    {
      bootstrap: true,
      disclosure: true,
      reuse: "schema",
      clearsErrorCodes: ["unknown_tool", "forbidden"],
      examples: [
        {
          queries: ["collection records", "interface authoring"],
          includeSchemas: true,
          limit: 4,
        },
      ],
    },
  );
  add(
    "describe_tool",
    "Retrieve a tool's complete schema and permission requirements.",
    "Learn arguments, results, use cases and side effects before invocation.",
    ["schema", "discovery"],
    z
      .object({
        toolId: z.string().max(100).optional(),
        toolIds: z
          .array(z.string().min(1).max(100))
          .min(1)
          .max(6)
          .optional()
          .describe(
            "Describe several exact capabilities together with compact schemas and usage examples. Provide either toolId or toolIds, never both.",
          ),
      })
      .strict()
      .superRefine((value, ctx) => {
        if ((value.toolId === undefined) === (value.toolIds === undefined))
          ctx.addIssue({
            code: "custom",
            message: "Provide either toolId or toolIds.",
          });
      }),
    "Tool metadata, JSON input/output schemas and result description.",
    async (a, c) => {
      if (a.toolIds) return batchDescribe(a.toolIds, c);
      const id = a.toolId!;
      if (!registry.resolve(id))
        throw new ServiceError("Unknown tool identifier.", 404);
      const denied = await new ToolExecutor(registry, c).discoveryAccess(id);
      if (denied) throw new ToolGuidanceError(denied.error, 403);
      return {
        ...registry.describe(id),
        schemaVersion: registry.schemaVersion(id),
      };
    },
    "read",
    {
      bootstrap: true,
      disclosure: true,
      reuse: "schema",
      examples: [{ toolIds: ["create_collection", "add_ui_components"] }],
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
    "read",
    { bootstrap: true, clearsGroups: ["resources"] },
  );
  add(
    "inspect_resource",
    "Read an existing authorized paw:// resource. For UI component types, schemas and examples use search_ui_components or inspect_component. Resource contents never disclose capability schemas; receive those through registry discovery.",
    "Progressively learn schemas, properties, relationships and supported operations.",
    ["discovery", "resources", "schema"],
    z.object({ uri: z.string().max(500) }).strict(),
    "Resource details, relationships and operation identifiers.",
    async (a, c) => inspectResource(a.uri, c),
    "read",
    { bootstrap: true, failureGroup: "resources", failureArgument: "uri" },
  );
  registerWorkspacesTools(registry, inspectResource);
  registerCollectionsTools(registry);
  registerInterfacesTools(registry);
  return registry;
}
