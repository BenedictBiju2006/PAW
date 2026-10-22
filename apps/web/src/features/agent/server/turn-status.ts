import type { SupabaseClient } from "@supabase/supabase-js";
import "server-only";
import { ServiceError } from "../../../shared/db/result";
export async function listTurnStatuses(
  db: SupabaseClient,
  workspaceId: string,
  childId: string,
) {
  const result = await db
    .from("agent_turns")
    .select(
      "id,status,notice,input_tokens,output_tokens,provider,model,model_requests,tool_calls,cached_input_tokens,created_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", childId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (result.error)
    throw new ServiceError(
      "Could not load response status. Check pending migrations.",
    );
  return result.data;
}
