import "server-only";
import { ServiceError } from "../../../shared/db/result";
import type { FeatureRequest } from "../../../shared/http/request";
import type { WorkspaceService } from "./service";
export async function handleWorkspaces(
  req: FeatureRequest,
  service: Pick<WorkspaceService, keyof WorkspaceService>,
) {
  const { path, body, method } = req;
  const [, workspaceId, child, childId, recordId] = path;
  let data: unknown;
  if (!workspaceId && method === "GET") data = await service.list();
  else if (!workspaceId && method === "POST")
    data = await service.create(body.name);
  else if (workspaceId && !child) {
    if (method === "GET") data = await service.workspace(workspaceId);
    else if (method === "PATCH")
      data = await service.rename(workspaceId, body.name);
    else if (method === "DELETE") {
      await service.remove(workspaceId, body.confirmed);
      data = { ok: true };
    } else throw new ServiceError("Method not allowed.", 405);
  } else throw new ServiceError("Not found.", 404);
  return data;
}
