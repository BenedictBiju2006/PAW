import { z } from "zod";
import { fieldsSchema } from "../core/schema";
import { ServiceError } from "../core/services";
import { ToolRegistry } from "./registry";
import {
  inspectResource,
  listResources,
  resourceListSchema,
} from "./resources";
import type { ToolContext, Permission, ToolMetadata } from "./types";
const workspaceId = z.uuid(),
  collectionId = z.uuid(),
  recordId = z.uuid();
const page = {
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(100).default(25),
};
const revision = z.number().int().positive();
const data = z.record(z.string(), z.json());
export function createToolRegistry() {
  const registry = new ToolRegistry();
  function add<S extends z.ZodObject>(
    id: string,
    description: string,
    purpose: string,
    keywords: string[],
    schema: S,
    result: string,
    handler: (args: z.infer<S>, context: ToolContext) => Promise<unknown>,
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
  add(
    "list_workspaces",
    "List accessible workspace summaries.",
    "Find existing persistent workspaces.",
    ["workspace", "list"],
    z.object(page).strict(),
    "Workspace summaries: id, name, revision, updated_at.",
    async (a, c) =>
      c.workspaceId
        ? [await c.service.workspace(c.workspaceId)].map(
            ({ id, name, revision, updated_at }) => ({
              id,
              name,
              revision,
              updated_at,
            }),
          )
        : c.service.list(a.offset, a.limit),
  );
  add(
    "create_workspace",
    "Create an empty persistent workspace.",
    "Start a new application with no domain template.",
    ["workspace", "create", "new"],
    z.object({ name: z.string().trim().min(1).max(100) }).strict(),
    "Workspace with id, name, interface and revision.",
    async (a, c) => c.service.create(a.name),
    "write",
  );
  add(
    "inspect_workspace",
    "Inspect workspace metadata and resource relationships.",
    "Explore a workspace before modifying its resources.",
    ["workspace", "inspect"],
    z.object({ workspaceId }).strict(),
    "Workspace metadata, revision, relationships and supported operations.",
    async (a, c) => inspectResource(`paw://workspaces/${a.workspaceId}`, c),
  );
  add(
    "rename_workspace",
    "Rename an accessible workspace.",
    "Change the workspace display name.",
    ["workspace", "rename"],
    z.object({ workspaceId, name: z.string().trim().min(1).max(100) }).strict(),
    "Updated workspace.",
    async (a, c) => c.service.rename(a.workspaceId, a.name),
    "write",
  );
  add(
    "list_collections",
    "List a workspace's immutable collection schemas.",
    "Discover the structured data available in a workspace.",
    ["collection", "schema", "list"],
    z.object({ workspaceId, ...page }).strict(),
    "Bounded collection list with field schemas.",
    async (a, c) => c.service.collections(a.workspaceId, a.offset, a.limit),
  );
  add(
    "inspect_collection",
    "Inspect a collection schema.",
    "Learn field keys, types, required flags and enum options before writing records.",
    ["collection", "schema", "inspect"],
    z.object({ workspaceId, collectionId }).strict(),
    "Collection id, workspace_id, name, fields; schema is immutable.",
    async (a, c) => c.service.collection(a.workspaceId, a.collectionId),
  );
  add(
    "create_collection",
    "Create a typed collection with immutable fields.",
    "Define structured persistent data for forms, tables and charts.",
    ["collection", "create", "fields", "schema"],
    z
      .object({
        workspaceId,
        name: z.string().trim().min(1).max(100),
        fields: fieldsSchema,
      })
      .strict(),
    "Created collection and field schema.",
    async (a, c) =>
      c.service.createCollection(a.workspaceId, {
        name: a.name,
        fields: a.fields,
      }),
    "write",
  );
  add(
    "query_records",
    "Query persistent records with exact filtering, sorting and pagination.",
    "Read collection data separately from schema inspection.",
    ["records", "query", "filter", "sort", "list"],
    z
      .object({
        workspaceId,
        collectionId,
        ...page,
        sort: z.string().optional(),
        direction: z.enum(["asc", "desc"]).optional(),
        filter: z.string().optional(),
        value: z.string().max(10000).optional(),
      })
      .strict(),
    "{records, total, offset, limit}; records include data and updated_at concurrency token.",
    async (a, c) => {
      const { workspaceId, collectionId, ...options } = a;
      return c.service.records(workspaceId, collectionId, options);
    },
  );
  add(
    "create_record",
    "Create a validated collection record.",
    "Persist structured data according to the immutable field schema.",
    ["records", "create", "insert"],
    z.object({ workspaceId, collectionId, data }).strict(),
    "Created record including id, data and updated_at.",
    async (a, c) =>
      c.service.writeRecord(a.workspaceId, a.collectionId, a.data),
    "write",
  );
  add(
    "update_record",
    "Update a record with its expected updated_at timestamp.",
    "Edit persistent data without overwriting concurrent changes.",
    ["records", "update", "edit", "concurrency"],
    z
      .object({
        workspaceId,
        collectionId,
        recordId,
        data,
        updatedAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
    "Updated record; stale timestamps return conflict.",
    async (a, c) =>
      c.service.writeRecord(
        a.workspaceId,
        a.collectionId,
        a.data,
        a.recordId,
        a.updatedAt,
      ),
    "write",
  );
  add(
    "delete_record",
    "Delete a record after trusted user confirmation.",
    "Remove a specific record; model arguments cannot provide confirmation.",
    ["records", "delete", "remove"],
    z.object({ workspaceId, collectionId, recordId }).strict(),
    "null on success; confirmation_required unless the trusted host obtains user approval.",
    async (a, c) =>
      c.service.deleteRecord(a.workspaceId, a.collectionId, a.recordId, true),
    "delete",
  );
  add(
    "aggregate_records",
    "Aggregate a field across a collection.",
    "Compute full-collection counts and numeric aggregates for charts.",
    ["records", "aggregate", "chart", "count"],
    z
      .object({ workspaceId, collectionId, field: z.string().min(1).max(64) })
      .strict(),
    "Counts and numeric aggregates from the authorized collection.",
    async (a, c) => c.service.aggregate(a.workspaceId, a.collectionId, a.field),
  );
  add(
    "get_catalog",
    "Retrieve the official PAW A2UI component catalog.",
    "Discover supported component schemas, properties and actions before building an interface.",
    ["a2ui", "interface", "catalog", "components"],
    z.object({}).strict(),
    "Official A2UI catalog JSON with components and supported PAW actions.",
    async (a, c) => c.service.catalog(),
  );
  add(
    "inspect_component",
    "Inspect a supported component type and its property schema.",
    "Learn how to construct a catalog component such as CollectionForm or DataTable.",
    ["a2ui", "components", "properties", "schema"],
    z.object({ component: z.string().max(100) }).strict(),
    "Component JSON schema.",
    async (a, c) => {
      const components = (c.service.catalog() as any).components;
      if (!Object.hasOwn(components, a.component))
        throw new ServiceError("Unknown component type.", 404);
      return components[a.component];
    },
  );
  add(
    "inspect_interface",
    "Retrieve the current A2UI interface, revision and reconstructed components.",
    "Inspect authoritative UI state before appending messages or saving a definition.",
    ["a2ui", "interface", "inspect", "revision"],
    z.object({ workspaceId }).strict(),
    "{definition, revision, surfaces}; each surface includes current component properties.",
    async (a, c) => {
      const w = await c.service.workspace(a.workspaceId);
      return {
        definition: w.interface,
        revision: w.revision,
        surfaces: await c.service.inspect(a.workspaceId),
      };
    },
  );
  add(
    "apply_interface_messages",
    "Apply official A2UI messages incrementally with an expected revision.",
    "Mutate current components or data bindings through the existing validation pipeline.",
    ["a2ui", "interface", "messages", "update"],
    z
      .object({
        workspaceId,
        messages: z.array(z.json()).min(1).max(200),
        revision,
      })
      .strict(),
    "Saved workspace with new interface revision; invalid A2UI or stale revisions fail atomically.",
    async (a, c) =>
      c.service.applyInterfaceMessages(a.workspaceId, a.messages, a.revision),
    "write",
  );
  add(
    "save_interface",
    "Save a complete validated A2UI definition with an expected revision.",
    "Construct or restore the workspace interface without changing collection data.",
    ["a2ui", "interface", "save", "build"],
    z.object({ workspaceId, definition: z.json(), revision }).strict(),
    "Saved workspace with incremented revision.",
    async (a, c) =>
      c.service.saveInterface(a.workspaceId, a.definition, a.revision),
    "write",
  );
  add(
    "list_revisions",
    "List original saved interface revisions.",
    "Inspect revision history and recover previous definitions.",
    ["a2ui", "interface", "history", "revision"],
    z.object({ workspaceId, ...page }).strict(),
    "Bounded revisions with revision number, definition and created_at.",
    async (a, c) => c.service.revisions(a.workspaceId, a.offset, a.limit),
  );
  return registry;
}
