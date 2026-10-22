import "server-only";
import { z } from "zod";
import { ToolExecutor } from "../features/tooling/server/public";
import type { FeatureRequest } from "../shared/http/request";
import type { WorkspaceServices } from "./services";
import { createToolRegistry } from "./tools";
export async function handleTools(
  req: FeatureRequest,
  service: WorkspaceServices,
) {
  const { body } = req;
  const request = z
    .object({
      toolId: z.string().max(100),
      arguments: z.record(z.string(), z.json()),
      workspaceId: z.uuid().optional(),
    })
    .strict()
    .parse(body);
  const executor = new ToolExecutor(createToolRegistry(), {
    service,
    workspaceId: request.workspaceId,
    permissions: new Set(["read", "write", "delete"]),
  });
  const result = await executor.execute(request.toolId, request.arguments);
  return result;
}
