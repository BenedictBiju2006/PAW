import type { SupabaseClient } from "@supabase/supabase-js";
import "server-only";
import {
  cancelAgent as cancel,
  agentResponse as response,
  type AgentHost,
} from "../features/agent/server/public";
import { ConversationService } from "../features/chat/server/public";
import {
  ProviderSettingsService,
  resolveProvider,
} from "../features/providers/server/public";
import { ToolExecutor } from "../features/tooling/server/public";
import { privilegedPersistence } from "../shared/db/privileged";
import { createWorkspaceServices } from "./services";
import { createToolRegistry } from "./tools";
export { privilegedPersistence };
function host(db: SupabaseClient, actor: string): AgentHost {
  const service = createWorkspaceServices(db, actor);
  return {
    admin: privilegedPersistence,
    conversations: new ConversationService(db, service),
    settings: (admin, actor) =>
      new ProviderSettingsService(admin, actor).resolve(),
    provider: (id) => resolveProvider(id).adapter,
    executor: (workspaceId) =>
      new ToolExecutor(createToolRegistry(), {
        service,
        workspaceId,
        permissions: new Set(["read", "write", "delete"]),
      }),
  };
}
export function agentResponse(
  actor: string,
  input: unknown,
  db: SupabaseClient,
  signal: AbortSignal,
) {
  return response(actor, input, signal, host(db, actor));
}
export function cancelAgent(actor: string, input: unknown, db: SupabaseClient) {
  return cancel(actor, input, host(db, actor));
}
