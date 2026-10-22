import "server-only";
import type { ToolContext } from "../features/tooling/public";
import type { ToolRegistry } from "../features/tooling/server/public";
import { createMcpAdapter as adapter } from "../features/tooling/server/public";
import type { WorkspaceServices } from "./services";
export function createMcpAdapter(
  registry: ToolRegistry<WorkspaceServices>,
  context: ToolContext<WorkspaceServices>,
) {
  return adapter(registry, context, {
    defaultKind: context.workspaceId ? "collections" : "workspaces",
    templates: [
      {
        uriTemplate: "paw://workspaces/{workspaceId}",
        name: "Workspace",
        mimeType: "application/json",
      },
      {
        uriTemplate: "paw://workspaces/{workspaceId}/interface",
        name: "Current interface",
        mimeType: "application/json",
      },
      {
        uriTemplate:
          "paw://workspaces/{workspaceId}/collections/{collectionId}/schema",
        name: "Collection schema",
        mimeType: "application/json",
      },
      {
        uriTemplate:
          "paw://workspaces/{workspaceId}/collections/{collectionId}/records/{recordId}",
        name: "Record",
        mimeType: "application/json",
      },
      {
        uriTemplate:
          "paw://workspaces/{workspaceId}/components/{surfaceId}/{componentId}",
        name: "A2UI component",
        mimeType: "application/json",
      },
      {
        uriTemplate: "paw://workspaces/{workspaceId}/revisions/{revision}",
        name: "Interface revision",
        mimeType: "application/json",
      },
    ],
  });
}
