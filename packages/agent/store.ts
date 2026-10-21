import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { checked, ServiceError } from "../core/services";
import { messageInput } from "../conversations/schema";
export type TurnStatus =
  "running" | "completed" | "failed" | "cancelled" | "limited" | "interrupted";
export type Turn = {
  id: string;
  status: TurnStatus;
  input_tokens: number;
  output_tokens: number;
  notice: string | null;
  model: string;
  provider: string;
  workspace_id: string;
  conversation_id: string;
};
/** Server-only RPC persistence. Each RPC rechecks actor/workspace ownership. */
export class AgentStore {
  constructor(
    private admin: SupabaseClient,
    private actor: string,
  ) {
    z.uuid().parse(actor);
  }
  async start(input: {
    id: string;
    workspaceId: string;
    conversationId: string;
    text: string;
    provider: string;
    model: string;
  }): Promise<{ started: boolean; turn: Turn }> {
    const result = checked(
      await this.admin.rpc("start_agent_turn", {
        actor: this.actor,
        turn: input.id,
        workspace: input.workspaceId,
        conversation: input.conversationId,
        request_hash: createHash("sha256").update(input.text).digest("hex"),
        user_text: input.text,
        model_provider: input.provider,
        model_id: input.model,
      }),
    );
    return result;
  }
  async event(
    turnId: string,
    key: string,
    role: "assistant" | "tool",
    content: unknown,
  ) {
    const value = messageInput.parse({ role, content });
    if (Buffer.byteLength(JSON.stringify(value.content)) > 95000)
      throw new ServiceError("Agent event exceeded the persistence limit.");
    return checked(
      await this.admin.rpc("append_agent_event", {
        actor: this.actor,
        turn: turnId,
        event: key,
        message_role: role,
        blocks: value.content,
      }),
    ) as boolean;
  }
  async diagnostics(
    id: string,
    requests: number,
    calls: number,
    cached: number | null,
  ) {
    checked(
      await this.admin.rpc("record_turn_diagnostics", {
        actor: this.actor,
        turn: id,
        requests,
        calls,
        cached,
      }),
    );
  }
  async finish(
    id: string,
    status: Exclude<TurnStatus, "running" | "interrupted">,
    input: number,
    output: number,
    notice: string | null,
  ) {
    checked(
      await this.admin.rpc("finish_agent_turn", {
        actor: this.actor,
        turn: id,
        final_status: status,
        input_count: input,
        output_count: output,
        explanation: notice,
      }),
    );
  }
}
