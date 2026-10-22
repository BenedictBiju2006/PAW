import type { SupabaseClient } from "@supabase/supabase-js";
import "server-only";
import { listTurnStatuses } from "../features/agent/server/public";
import {
  ConversationService,
  handleChat,
} from "../features/chat/server/public";
import { handleCollections } from "../features/collections/server/public";
import { handleInterfaces } from "../features/interfaces/server/public";
import {
  handleSettings,
  ProviderSettingsService,
} from "../features/providers/server/public";
import { handleWorkspaces } from "../features/workspaces/server/public";
import { ServiceError } from "../shared/db/result";
import type { FeatureRequest } from "../shared/http/request";
import {
  agentResponse,
  cancelAgent,
  privilegedPersistence,
} from "./agent-host";
import { createWorkspaceServices } from "./services";
import { handleTools } from "./tool-http";
export async function dispatchAuthenticated(
  req: FeatureRequest,
  db: SupabaseClient,
  actor: string,
) {
  const { path, method, body } = req;
  const service = createWorkspaceServices(db, actor);
  if (path[0] === "ai-settings" && path.length === 1)
    return handleSettings(
      req,
      new ProviderSettingsService(privilegedPersistence(), actor),
    );
  if (path[0] === "agent" && method === "POST") {
    if (path.length === 1) return agentResponse(actor, body, db, req.signal);
    if (path.length === 2 && path[1] === "cancel")
      return cancelAgent(actor, body, db);
  }
  if (path[0] === "tools" && path.length === 1 && method === "POST")
    return handleTools(req, service);
  if (path[0] === "catalog" && method === "GET") return service.catalog();
  if (path[0] !== "workspaces") throw new ServiceError("Not found.", 404);
  if (path[2] === "conversations")
    return handleChat(
      req,
      new ConversationService(db, service),
      (workspace, conversation) =>
        listTurnStatuses(db, workspace, conversation),
    );
  if (path[2] === "collections") return handleCollections(req, service);
  if (path[2] === "interface" || path[2] === "revisions")
    return handleInterfaces(req, service);
  return handleWorkspaces(req, service);
}
