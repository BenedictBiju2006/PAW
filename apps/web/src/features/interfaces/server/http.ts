import "server-only";
import { ServiceError } from "../../../shared/db/result";
import type { FeatureRequest } from "../../../shared/http/request";
import type { InterfaceService } from "./service";
export async function handleInterfaces(
  req: FeatureRequest,
  service: Pick<InterfaceService, keyof InterfaceService>,
) {
  const { path, body, method } = req;
  const [, workspaceId, child, childId, recordId] = path;
  let data: unknown;
  if (child === "interface" && method === "GET")
    data = await service.inspect(workspaceId);
  else if (child === "interface" && method === "PATCH")
    data = await service.applyInterfaceMessages(
      workspaceId,
      body.messages,
      body.revision,
    );
  else if (child === "interface" && method === "PUT")
    data = await service.saveInterface(
      workspaceId,
      body.definition,
      body.revision,
    );
  else if (child === "revisions" && method === "GET")
    data = await service.revisions(workspaceId);
  else throw new ServiceError("Not found.", 404);

  return data;
}
