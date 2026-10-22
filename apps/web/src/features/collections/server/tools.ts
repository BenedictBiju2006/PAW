import { z } from "zod";
import { ServiceError } from "../../../shared/db/result";
import type { ToolRegistry } from "../../tooling/server/registry";
import { registrar } from "../../tooling/server/register";
import type { CollectionService } from "./service";
import { fieldsSchema } from "../model/schema";
const workspaceId=z.uuid(),collectionId=z.uuid(),recordId=z.uuid();
const page={offset:z.number().int().min(0).max(100000).default(0),limit:z.number().int().min(1).max(100).default(25)};
const revision=z.number().int().positive();
const data=z.record(z.string(),z.json());
export function registerCollectionsTools<Services extends Pick<CollectionService, keyof CollectionService>>(registry:ToolRegistry<Services>) {
const add=registrar(registry);
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
}
