import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checked, ServiceError } from "../../../shared/db/result";
import { id, name } from "../../../shared/validation/identity";
import { fieldsSchema, validateData, type Collection } from "../model/schema";
import type { WorkspaceAccess } from "../../workspaces/server/service";
export class CollectionService {
constructor(private db:SupabaseClient, private workspaces:WorkspaceAccess) {}
async collections(
    workspaceId: string,
    offset = 0,
    limit = 1000,
  ): Promise<Collection[]> {
    z.number().int().min(0).max(100000).parse(offset);
    z.number().int().min(1).max(1000).parse(limit);
    await this.workspaces.workspace(workspaceId);
    return checked(
      await this.db
        .from("collections")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at")
        .order("id")
        .range(offset, offset + limit - 1),
    ) as Collection[];
  }
async createCollection(workspaceId: string, input: unknown) {
    await this.workspaces.workspace(workspaceId);
    const value = z
      .object({ name, fields: fieldsSchema })
      .strict()
      .parse(input);
    return checked(
      await this.db
        .from("collections")
        .insert({ ...value, workspace_id: workspaceId })
        .select("*")
        .single(),
    );
  }
async collection(workspaceId: string, collectionId: string) {
    await this.workspaces.workspace(workspaceId);
    id.parse(collectionId);
    const collection = checked(
      await this.db
        .from("collections")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", collectionId)
        .maybeSingle(),
    ) as Collection | null;
    if (!collection) throw new ServiceError("Collection not found.", 404);
    return collection;
  }
async records(
    workspaceId: string,
    collectionId: string,
    input: unknown = {},
  ) {
    const collection = await this.collection(workspaceId, collectionId);
    const options = z
      .object({
        offset: z.coerce.number().int().min(0).max(100000).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        sort: z.string().optional(),
        direction: z.enum(["asc", "desc"]).default("desc"),
        filter: z.string().optional(),
        value: z.string().max(10000).optional(),
      })
      .parse(input);
    const field = (key: string) => {
      const found = collection.fields.find((f) => f.key === key);
      if (!found) throw new ServiceError("Unknown field.");
      return found;
    };
    let query = this.db
      .from("records")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .eq("collection_id", collectionId);
    if (options.filter && options.value !== undefined) {
      const f = field(options.filter);
      const value =
        f.type === "number"
          ? z.coerce.number().finite().parse(options.value)
          : f.type === "boolean"
            ? z.enum(["true", "false"]).parse(options.value) === "true"
            : options.value;
      query = query.contains("data", { [f.key]: value });
    }
    if (options.sort) {
      field(options.sort);
      query = query.order(`data->${options.sort}`, {
        ascending: options.direction === "asc",
        nullsFirst: false,
      });
    } else query = query.order("created_at", { ascending: false });
    const result = await query
      .order("id")
      .range(options.offset, options.offset + options.limit - 1);
    return {
      records: checked(result),
      total: result.count ?? 0,
      offset: options.offset,
      limit: options.limit,
    };
  }
async record(workspaceId: string, collectionId: string, recordId: string) {
    await this.collection(workspaceId, collectionId);
    id.parse(recordId);
    const record = checked(
      await this.db
        .from("records")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("collection_id", collectionId)
        .eq("id", recordId)
        .maybeSingle(),
    );
    if (!record) throw new ServiceError("Record not found.", 404);
    return record;
  }
async aggregate(workspaceId: string, collectionId: string, fieldKey: string) {
    const collection = await this.collection(workspaceId, collectionId);
    if (!collection.fields.some((f) => f.key === fieldKey))
      throw new ServiceError("Unknown field.");
    return checked(
      await this.db.rpc("aggregate_records", {
        target_workspace: workspaceId,
        target_collection: collectionId,
        field_key: fieldKey,
      }),
    );
  }
async writeRecord(
    workspaceId: string,
    collectionId: string,
    input: unknown,
    recordId?: string,
    expectedUpdatedAt?: unknown,
  ) {
    const collection = await this.collection(workspaceId, collectionId);
    const data = validateData(collection.fields, input);
    if (recordId) {
      id.parse(recordId);
      const expected = z.iso
        .datetime({ offset: true })
        .parse(expectedUpdatedAt);
      const record = checked(
        await this.db
          .from("records")
          .update({ data })
          .eq("id", recordId)
          .eq("workspace_id", workspaceId)
          .eq("collection_id", collectionId)
          .eq("updated_at", expected)
          .select("*")
          .maybeSingle(),
      );
      if (!record)
        throw new ServiceError(
          "Record changed or was deleted. Reload before editing.",
          409,
        );
      return record;
    }
    return checked(
      await this.db
        .from("records")
        .insert({
          workspace_id: workspaceId,
          collection_id: collectionId,
          data,
        })
        .select("*")
        .single(),
    );
  }
async deleteRecord(
    workspaceId: string,
    collectionId: string,
    recordId: string,
    confirmation: unknown,
  ) {
    await this.collection(workspaceId, collectionId);
    id.parse(recordId);
    if (confirmation !== true)
      throw new ServiceError("Deletion must be confirmed.");
    const result = checked(
      await this.db
        .from("records")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("collection_id", collectionId)
        .eq("id", recordId)
        .select("id"),
    );
    if (!result?.length) throw new ServiceError("Record not found.", 404);
  }
}
