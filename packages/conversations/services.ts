import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { checked, ServiceError, WorkspaceService } from "../core/services";
import { id, name } from "../core/schema";
import { messageInput, type Conversation, type Message } from "./schema";
const paging = z
  .object({
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export class ConversationService {
  constructor(
    private db: SupabaseClient,
    private workspaces: WorkspaceService,
  ) {}
  async conversation(
    workspaceId: string,
    conversationId: string,
  ): Promise<Conversation> {
    await this.workspaces.workspace(workspaceId);
    id.parse(conversationId);
    const result = checked(
      await this.db
        .from("conversations")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", conversationId)
        .maybeSingle(),
    );
    if (!result) throw new ServiceError("Conversation not found.", 404);
    return result;
  }
  async create(
    workspaceId: string,
    title: unknown = "New conversation",
  ): Promise<Conversation> {
    await this.workspaces.workspace(workspaceId);
    return required(
      checked(
        await this.db
          .from("conversations")
          .insert({ workspace_id: workspaceId, title: name.parse(title) })
          .select("*")
          .single(),
      ),
    );
  }
  async list(workspaceId: string, input: unknown = {}) {
    await this.workspaces.workspace(workspaceId);
    const { offset, limit } = paging.parse(input);
    const result = await this.db
      .from("conversations")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("created_at")
      .order("id")
      .range(offset, offset + limit - 1);
    const conversations = checked(result) as Conversation[];
    return {
      conversations,
      nextOffset: offset + limit < (result.count ?? 0) ? offset + limit : null,
    };
  }
  async messages(
    workspaceId: string,
    conversationId: string,
    input: unknown = {},
  ) {
    await this.conversation(workspaceId, conversationId);
    const { offset, limit } = paging.parse(input);
    const result = await this.db
      .from("messages")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .eq("conversation_id", conversationId)
      .order("sequence")
      .range(offset, offset + limit - 1);
    return {
      messages: checked(result) as Message[],
      nextOffset: offset + limit < (result.count ?? 0) ? offset + limit : null,
    };
  }
  async recent(
    workspaceId: string,
    conversationId: string,
    before?: number,
    limit = 40,
  ) {
    await this.conversation(workspaceId, conversationId);
    z.number().int().min(1).max(100).parse(limit);
    let query = this.db
      .from("messages")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("conversation_id", conversationId);
    if (before !== undefined)
      query = query.lt("sequence", z.number().int().positive().parse(before));
    const result = checked(
      await query.order("sequence", { ascending: false }).limit(limit + 1),
    ) as Message[];
    const hasOlder = result.length > limit;
    const messages = result.slice(0, limit).reverse();
    return { messages, before: hasOlder ? messages[0]?.sequence : null };
  }
  async append(
    workspaceId: string,
    conversationId: string,
    input: unknown,
  ): Promise<Message> {
    await this.conversation(workspaceId, conversationId);
    const value = messageInput.parse(input);
    if (Buffer.byteLength(JSON.stringify(value.content)) > 100000)
      throw new ServiceError("Message content exceeds 100,000 bytes.");
    return required(
      checked(
        await this.db
          .from("messages")
          .insert({
            ...value,
            workspace_id: workspaceId,
            conversation_id: conversationId,
          })
          .select("*")
          .single(),
      ),
    );
  }
  async rename(
    workspaceId: string,
    conversationId: string,
    title: unknown,
  ): Promise<Conversation> {
    await this.conversation(workspaceId, conversationId);
    return required(
      checked(
        await this.db
          .from("conversations")
          .update({ title: name.parse(title) })
          .eq("workspace_id", workspaceId)
          .eq("id", conversationId)
          .select("*")
          .single(),
      ),
    );
  }
  async remove(
    workspaceId: string,
    conversationId: string,
    confirmation: unknown,
  ) {
    await this.conversation(workspaceId, conversationId);
    if (confirmation !== true)
      throw new ServiceError("Deletion must be confirmed.");
    const removed = checked(
      await this.db
        .from("conversations")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", conversationId)
        .select("id"),
    );
    if (!removed?.length)
      throw new ServiceError("Conversation not found.", 404);
  }
}

function required<T>(value: T | null): T {
  if (value === null)
    throw new ServiceError(
      "The resource was not returned. Retry the operation.",
      404,
    );
  return value;
}
