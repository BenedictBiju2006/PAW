import { z } from "zod";
import { ServiceError } from "../../../shared/db/result";
import type { ToolContext } from "../../tooling/server/types";
import type { ToolRegistry } from "../../tooling/server/registry";
import { registrar } from "../../tooling/server/register";
import type { WorkspaceService } from "./service";
const workspaceId=z.uuid(),collectionId=z.uuid(),recordId=z.uuid();
const page={offset:z.number().int().min(0).max(100000).default(0),limit:z.number().int().min(1).max(100).default(25)};
const revision=z.number().int().positive();
const data=z.record(z.string(),z.json());
export function registerWorkspacesTools<Services extends Pick<WorkspaceService, keyof WorkspaceService>>(registry:ToolRegistry<Services>, inspectResource:(uri:string,context:ToolContext<Services>)=>Promise<unknown>) {
const add=registrar(registry);
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
}
