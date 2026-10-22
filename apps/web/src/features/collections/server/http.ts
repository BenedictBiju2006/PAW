import "server-only";
import { ServiceError } from "../../../shared/db/result";
import type { FeatureRequest } from "../../../shared/http/request";
import type { CollectionService } from "./service";
export async function handleCollections(
  req: FeatureRequest,
  service: Pick<CollectionService, keyof CollectionService>,
) {
  const { path, body, method } = req;
  const [, workspaceId, child, childId, recordId] = path;
  let data: unknown;
  if (child === "collections" && !childId && method === "GET")
    data = await service.collections(workspaceId);
  else if (child === "collections" && !childId && method === "POST")
    data = await service.createCollection(workspaceId, body);
  else if (
    child === "collections" &&
    childId &&
    recordId === "aggregate" &&
    method === "GET"
  )
    data = await service.aggregate(
      workspaceId,
      childId,
      req.query.get("field") || "",
    );
  else if (child === "collections" && childId && !recordId && method === "GET")
    data = await service.records(
      workspaceId,
      childId,
      Object.fromEntries(req.query),
    );
  else if (child === "collections" && childId && !recordId && method === "POST")
    data = await service.writeRecord(workspaceId, childId, body.data);
  else if (child === "collections" && childId && recordId && method === "PATCH")
    data = await service.writeRecord(
      workspaceId,
      childId,
      body.data,
      recordId,
      body.updatedAt,
    );
  else if (
    child === "collections" &&
    childId &&
    recordId &&
    method === "DELETE"
  ) {
    await service.deleteRecord(workspaceId, childId, recordId, body.confirmed);
    data = { ok: true };
  } else throw new ServiceError("Not found.", 404);
  return data;
}
