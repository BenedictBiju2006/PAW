import "server-only";
import { z } from "zod";
import { catalogComponents } from "../features/interfaces/public";
import type { ToolContext as BaseContext } from "../features/tooling/public";
import { resourceFeedback, validResourceUri } from "./resource-guidance";
import { ToolGuidanceError } from "../features/tooling/server/public";
import { ServiceError } from "../shared/db/result";
import type { WorkspaceServices } from "./services";
type ToolContext = BaseContext<WorkspaceServices>;
export const resourceKinds = [
  "workspaces",
  "collections",
  "schemas",
  "records",
  "interfaces",
  "components",
  "catalog",
  "revisions",
] as const;
export const resourceListSchema = z
  .object({
    kind: z.enum(resourceKinds).default("workspaces"),
    workspaceId: z.uuid().optional(),
    collectionId: z.uuid().optional(),
    offset: z.number().int().min(0).max(100000).default(0),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();
export type Resource = {
  uri: string;
  name: string;
  kind: string;
  description: string;
  mimeType: "application/json";
};
function resource(
  uri: string,
  name: string,
  kind: string,
  description: string,
): Resource {
  return { uri, name, kind, description, mimeType: "application/json" };
}
export const workspaceUri = (id: string) => `paw://workspaces/${id}`;
export async function listResources(
  args: z.infer<typeof resourceListSchema>,
  context: ToolContext,
) {
  const { service, workspaceId: scope } = context;
  const { kind, offset, limit } = args;
  const workspaceId = args.workspaceId ?? scope;
  let items: Resource[];
  if (kind === "catalog")
    items = [
      resource(
        "paw://catalog",
        "PAW component catalog",
        kind,
        "Official A2UI v0.9.1 component properties and supported actions.",
      ),
    ];
  else if (kind === "workspaces") {
    const workspaces = scope
      ? [await service.workspace(scope)]
      : await service.list(offset, limit);
    items = (workspaces ?? []).map((w) =>
      resource(
        workspaceUri(w.id),
        w.name,
        kind,
        `Current interface revision ${w.revision}; inspect for collections and interface relationships.`,
      ),
    );
    return {
      items: scope && offset > 0 ? [] : items,
      nextOffset: !scope && items.length === limit ? offset + limit : null,
    };
  } else {
    if (!workspaceId)
      throw new ServiceError(
        "workspaceId is required for workspace resources.",
      );
    await service.workspace(workspaceId);
    const base = workspaceUri(workspaceId);
    if (kind === "collections" || kind === "schemas") {
      const collections = await service.collections(workspaceId, offset, limit);
      items = collections.map((c) =>
        resource(
          `${base}/collections/${c.id}${kind === "schemas" ? "/schema" : ""}`,
          c.name,
          kind,
          `${c.fields.length} immutable typed fields. Query records separately.`,
        ),
      );
      return {
        items,
        nextOffset: items.length === limit ? offset + limit : null,
      };
    } else if (kind === "interfaces")
      items = [
        resource(
          `${base}/interface`,
          "Current interface",
          kind,
          "Authoritative A2UI messages, surfaces and expected revision.",
        ),
      ];
    else if (kind === "components")
      items = (await service.inspect(workspaceId)).flatMap((s) =>
        s.components.map((c) =>
          resource(
            `${base}/components/${encodeURIComponent(s.surfaceId)}/${c.id}`,
            c.id,
            kind,
            `${c.component} on surface ${s.surfaceId}; inspect for properties and relationships.`,
          ),
        ),
      );
    else if (kind === "records") {
      if (!args.collectionId)
        throw new ServiceError("collectionId is required to explore records.");
      const result = await service.records(workspaceId, args.collectionId, {
        offset,
        limit,
      });
      return {
        items: (result.records ?? []).map((r) =>
          resource(
            `${base}/collections/${args.collectionId}/records/${r.id}`,
            r.id,
            kind,
            "Persistent record. Inspect for values and concurrency timestamp.",
          ),
        ),
        nextOffset: offset + limit < result.total ? offset + limit : null,
      };
    } else {
      const revisions = await service.revisions(workspaceId, offset, limit);
      return {
        items: (revisions ?? []).map((r) =>
          resource(
            `${base}/revisions/${r.revision}`,
            `Revision ${r.revision}`,
            kind,
            `Saved ${r.created_at}; inspect original definition.`,
          ),
        ),
        nextOffset: revisions?.length === limit ? offset + limit : null,
      };
    }
  }
  return {
    items: items.slice(offset, offset + limit),
    nextOffset: offset + limit < items.length ? offset + limit : null,
  };
}
export async function inspectResource(uri: string, context: ToolContext) {
  const { service, workspaceId: scope } = context;
  if (uri === "paw://catalog")
    return {
      uri,
      kind: "catalog",
      schema: service.catalog(),
      operations: ["search_ui_components", "get_catalog", "inspect_component"],
    };
  const match = /^paw:\/\/workspaces\/([0-9a-f-]{36})(?:\/(.*))?$/.exec(uri);
  if (!match || !z.uuid().safeParse(match[1]).success)
    throw await resourceFeedback(uri, context, "resource_invalid");
  const [, workspaceId, tail] = match;
  if (scope && scope !== workspaceId)
    throw await resourceFeedback(uri, context, "forbidden");
  let workspace;
  try {
    workspace = await service.workspace(workspaceId);
  } catch (error) {
    if (error instanceof ServiceError && [403, 404].includes(error.status))
      throw await resourceFeedback(
        uri,
        context,
        error.status === 403 ? "forbidden" : "not_found",
      );
    throw error;
  }
  if (!new RegExp(validResourceUri).test(uri))
    throw await resourceFeedback(uri, context, "resource_invalid", workspaceId);
  try {
    const base = workspaceUri(workspaceId);
    if (!tail)
      return {
        uri,
        kind: "workspace",
        id: workspaceId,
        name: workspace.name,
        revision: workspace.revision,
        relationships: {
          collections: `${base}/collections`,
          interface: `${base}/interface`,
          revisions: `${base}/revisions`,
        },
        operations: ["rename_workspace", "list_resources", "inspect_interface"],
      };
    if (tail === "interface")
      return {
        uri,
        kind: "interface",
        revision: workspace.revision,
        definition: workspace.interface,
        error: workspace.interfaceError,
        operations: [
          "add_ui_components",
          "update_ui_component",
          "apply_interface_messages",
          "save_interface",
          "list_revisions",
        ],
      };
    if (tail === "collections")
      return listResources(
        { kind: "collections", workspaceId, offset: 0, limit: 25 },
        context,
      );
    if (tail === "revisions")
      return listResources(
        { kind: "revisions", workspaceId, offset: 0, limit: 25 },
        context,
      );
    const parts = tail.split("/");
    if (parts[0] === "collections" && z.uuid().safeParse(parts[1]).success) {
      if (parts.length === 2 || (parts.length === 3 && parts[2] === "schema")) {
        const c = await service.collection(workspaceId, parts[1]);
        return {
          uri,
          kind: parts[2] === "schema" ? "schema" : "collection",
          ...c,
          immutableSchema: true,
          relationships: {
            workspace: base,
            schema: `${base}/collections/${c.id}/schema`,
          },
          operations: [
            "query_records",
            "create_record",
            "update_record",
            "delete_record",
            "aggregate_records",
          ],
        };
      }
      if (
        parts.length === 4 &&
        parts[2] === "records" &&
        z.uuid().safeParse(parts[3]).success
      )
        return {
          uri,
          kind: "record",
          record: await service.record(workspaceId, parts[1], parts[3]),
          schema: (await service.collection(workspaceId, parts[1])).fields,
          operations: ["update_record", "delete_record"],
        };
    }
    if (
      parts[0] === "revisions" &&
      parts.length === 2 &&
      /^[1-9]\d*$/.test(parts[1])
    )
      return {
        uri,
        kind: "revision",
        revision: await service.revision(workspaceId, Number(parts[1])),
        operations: ["save_interface"],
      };
    if (parts[0] === "components" && parts.length === 3) {
      const component = (await service.inspect(workspaceId))
        .find((s) => s.surfaceId === parts[1])
        ?.components.find((c) => c.id === parts[2]);
      if (!component) throw new ServiceError("Component not found.", 404);
      return {
        uri,
        kind: "component",
        component,
        schema: catalogComponents()[component.component],
        relationships: { interface: `${base}/interface` },
        operations: [
          "update_ui_component",
          "apply_interface_messages",
          "inspect_component",
        ],
      };
    }
    throw await resourceFeedback(uri, context, "resource_invalid", workspaceId);
  } catch (error) {
    if (error instanceof ToolGuidanceError) throw error;
    if (error instanceof ServiceError && [403, 404].includes(error.status))
      throw await resourceFeedback(
        uri,
        context,
        error.status === 403 ? "forbidden" : "not_found",
        workspaceId,
      );
    throw error;
  }
}
