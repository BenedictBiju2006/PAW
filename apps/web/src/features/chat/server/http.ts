import "server-only";
import { z } from "zod";
import { ServiceError } from "../../../shared/db/result";
import type { FeatureRequest } from "../../../shared/http/request";
import type { ConversationService } from "./services";
export async function handleChat(
  req: FeatureRequest,
  conversations: ConversationService,
  listTurns: (workspace: string, conversation: string) => Promise<unknown>,
) {
  const { path, body, method } = req;
  const [, workspaceId, , childId, recordId] = path;
  let data: unknown;
  if (
    path.length > 5 ||
    (recordId && !["messages", "turns"].includes(recordId))
  )
    throw new ServiceError("Not found.", 404);

  const paging = Object.fromEntries(req.query);
  if (childId && recordId === "turns" && method === "GET") {
    await conversations.conversation(workspaceId, childId);
    data = await listTurns(workspaceId, childId);
  } else if (!childId && !recordId && method === "GET")
    data = await conversations.list(workspaceId, paging);
  else if (!childId && !recordId && method === "POST")
    data = await conversations.create(workspaceId, body.title);
  else if (childId && !recordId && method === "PATCH")
    data = await conversations.rename(workspaceId, childId, body.title);
  else if (childId && !recordId && method === "DELETE") {
    await conversations.remove(workspaceId, childId, body.confirmed);
    data = { ok: true };
  } else if (childId && recordId === "messages" && method === "GET") {
    if (req.query.has("recent")) {
      const args = z
        .object({
          recent: z.literal("true"),
          before: z.coerce.number().int().positive().optional(),
        })
        .strict()
        .parse(paging);
      data = await conversations.recent(workspaceId, childId, args.before);
    } else data = await conversations.messages(workspaceId, childId, paging);
  } else if (childId && recordId === "messages" && method === "POST") {
    // Public chat cannot impersonate assistant/tool roles or forge activity.
    const { text } = z
      .object({ text: z.string().trim().min(1).max(50000) })
      .strict()
      .parse(body);
    data = await conversations.append(workspaceId, childId, {
      role: "user",
      content: [{ type: "text", text }],
    });
  } else throw new ServiceError("Method not allowed.", 405);

  return data;
}
