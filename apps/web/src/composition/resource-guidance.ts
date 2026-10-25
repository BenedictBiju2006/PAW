import "server-only";
import { z } from "zod";
import { ToolGuidanceError } from "../features/tooling/server/public";
import type { ToolContext } from "../features/tooling/public";
import type { WorkspaceServices } from "./services";

const uuid = (z.toJSONSchema(z.uuid()).pattern as string).slice(1, -1);
const identifier = "[A-Za-z_][A-Za-z0-9_]{0,63}";
const surface = "[A-Za-z_][A-Za-z0-9_-]{0,63}";
export const validResourceUri = `^(?:paw://catalog|paw://workspaces/${uuid}(?:/interface|/collections(?:/${uuid}(?:/schema|/records/${uuid})?)?|/revisions(?:/[1-9][0-9]{0,9})?|/components/${surface}/${identifier})?)$`;

/** Suggestions contain only placeholders and IDs verified through user services. */
export async function resourceFeedback(
  uri: string,
  context: ToolContext<WorkspaceServices>,
  code: "resource_invalid" | "not_found" | "forbidden",
  authorizedWorkspace?: string,
) {
  let workspaceId = authorizedWorkspace;
  if (!workspaceId && context.workspaceId) {
    try {
      await context.service.workspace(context.workspaceId);
      workspaceId = context.workspaceId;
    } catch {
      /* No identifiers in fallback guidance. */
    }
  }
  const base = workspaceId
    ? `paw://workspaces/${workspaceId}`
    : "paw://workspaces/{workspaceId}";
  const lower = uri.toLowerCase();
  const kind = /component|catalog/.test(lower)
    ? "components"
    : /record/.test(lower)
      ? "records"
      : /schema/.test(lower)
        ? "schemas"
        : /collection/.test(lower)
          ? "collections"
          : /interface/.test(lower)
            ? "interfaces"
            : /revision/.test(lower)
              ? "revisions"
              : "workspaces";
  const patterns: Record<string, string[]> = {
    workspaces: [base],
    interfaces: [`${base}/interface`],
    collections: [`${base}/collections`, `${base}/collections/{collectionId}`],
    schemas: [`${base}/collections/{collectionId}/schema`],
    records: [`${base}/collections/{collectionId}/records/{recordId}`],
    components: [
      `${base}/components/{surfaceId}/{componentId}`,
      "paw://catalog",
    ],
    revisions: [`${base}/revisions`, `${base}/revisions/{revision}`],
  };
  let listKind = workspaceId ? kind : "workspaces";
  let collectionId: string | undefined;
  if (workspaceId && kind === "records") {
    const candidate = uri.match(/\/collections\/([^/]+)/)?.[1];
    if (candidate && z.uuid().safeParse(candidate).success) {
      try {
        await context.service.collection(workspaceId, candidate);
        collectionId = candidate;
      } catch {
        /* List authorized collections instead of echoing guesses. */
      }
    }
    if (!collectionId) listKind = "collections";
  }
  const componentTypeAttempt =
    /^paw:\/\/(?:components|catalog\/components)\//.test(uri);
  return new ToolGuidanceError(
    {
      code,
      message:
        code === "resource_invalid"
          ? "Malformed PAW resource identifier."
          : code === "forbidden"
            ? "Resource access is not authorized in this workspace context."
            : "Resource not found or not accessible.",
      guidance: componentTypeAttempt
        ? "For UI component types/schemas/examples use search_ui_components, after describe_tool. Component resource URIs identify saved instances."
        : `Use the supported URI patterns. Collections use /collections/{collectionId}; schemas end in /schema. List resources instead of guessing identifiers.`,
      uriPatterns: patterns[kind],
      validUriPattern: validResourceUri,
      nextAction: componentTypeAttempt
        ? {
            tool: "describe_tool",
            arguments: { toolId: "search_ui_components" },
          }
        : {
            tool: "list_resources",
            arguments: {
              kind: listKind,
              ...(workspaceId ? { workspaceId } : {}),
              ...(collectionId ? { collectionId } : {}),
              limit: 10,
            },
          },
    },
    code === "forbidden" ? 403 : code === "not_found" ? 404 : 400,
  );
}
