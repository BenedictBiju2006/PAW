import type { SupabaseClient } from "@supabase/supabase-js";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import "server-only";
import { z } from "zod";
import { ServiceError } from "../../../shared/db/result";
import type { ConversationService } from "../../chat/server/public";
import type { ModelProvider } from "../../providers/public";
import type { ExecutionTools } from "../../tooling/public";
import { modelHistory } from "./context";
import { AgentOrchestrator } from "./orchestrator";
import { AgentStore } from "./store";
export interface AgentHost {
  admin: () => SupabaseClient;
  conversations: Pick<ConversationService, "conversation" | "recent">;
  settings: (
    db: SupabaseClient,
    actor: string,
  ) => Promise<{ provider: string; model: string; apiKey: string }>;
  provider: (id: string) => ModelProvider;
  executor: (workspace: string) => ExecutionTools;
}
const active = new Map<string, AbortController>();
export async function cancelAgent(
  actor: string,
  input: unknown,
  host: AgentHost,
) {
  const a = z
    .object({
      turnId: z.uuid(),
      workspaceId: z.uuid(),
      conversationId: z.uuid(),
    })
    .strict()
    .parse(input);
  await host.conversations.conversation(a.workspaceId, a.conversationId);
  const admin = host.admin();
  const { error } = await admin
    .from("agent_turns")
    .update({ cancel_requested: true })
    .eq("id", a.turnId)
    .eq("user_id", actor)
    .eq("workspace_id", a.workspaceId)
    .eq("conversation_id", a.conversationId)
    .eq("status", "running");
  if (error) throw new ServiceError("Unable to stop the response. Try again.");
  active.get(`${actor}:${a.turnId}`)?.abort();
  return { ok: true };
}
export async function agentResponse(
  actor: string,
  input: unknown,
  requestSignal: AbortSignal,
  host: AgentHost,
) {
  const a = z
    .object({
      turnId: z.uuid(),
      workspaceId: z.uuid(),
      conversationId: z.uuid(),
      text: z.string().trim().min(1).max(20000),
    })
    .strict()
    .parse(input);
  const conversations = host.conversations;
  await conversations.conversation(a.workspaceId, a.conversationId);
  const admin = host.admin(),
    settings = await host.settings(admin, actor);
  const store = new AgentStore(admin, actor);
  const started = await store.start({
    id: a.turnId,
    workspaceId: a.workspaceId,
    conversationId: a.conversationId,
    text: a.text,
    ...settings,
  });
  const stream = createUIMessageStream({
    onError: () =>
      "The response was interrupted. Reload saved messages; completed operations are preserved.",
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId: a.turnId });
      if (!started.started) {
        writer.write({
          type: "data-turn",
          data: {
            id: a.turnId,
            status: started.turn.status,
            notice:
              "This request was already accepted. It will not be executed again. Reload saved messages to see its status.",
          },
        });
        writer.write({ type: "finish" });
        return;
      }
      const controller = new AbortController();
      active.set(`${actor}:${a.turnId}`, controller);
      const signal = AbortSignal.any([controller.signal, requestSignal]);
      const polling = setInterval(() => {
        void admin
          .from("agent_turns")
          .select("cancel_requested")
          .eq("id", a.turnId)
          .eq("user_id", actor)
          .maybeSingle()
          .then(({ data, error }) => {
            if (data?.cancel_requested || error) controller.abort();
          });
      }, 1000);
      const opened = new Set<string>();
      try {
        const history = modelHistory(
          (
            await conversations.recent(
              a.workspaceId,
              a.conversationId,
              undefined,
              80,
            )
          ).messages,
        );
        const executor = host.executor(a.workspaceId);
        await new AgentOrchestrator(
          host.provider(settings.provider),
          executor,
          store,
        ).run(
          {
            turnId: a.turnId,
            workspaceId: a.workspaceId,
            conversationId: a.conversationId,
            model: settings.model,
            apiKey: settings.apiKey,
            history,
            signal,
          },
          (event) => {
            if (event.type === "text") {
              if (!opened.has(event.id)) {
                writer.write({ type: "text-start", id: event.id });
                opened.add(event.id);
              }
              writer.write({
                type: "text-delta",
                id: event.id,
                delta: event.text,
              });
            } else if (event.type === "activity")
              writer.write({
                type: "data-activity",
                id: event.activity.invocationId,
                data: event.activity,
              });
            else if (event.type === "mutation")
              writer.write({
                type: "data-mutation",
                data: { workspaceId: event.workspaceId },
                transient: true,
              });
            else writer.write({ type: "data-turn", data: event });
          },
        );
      } catch {
        await store.finish(
          a.turnId,
          "failed",
          0,
          0,
          "The response was interrupted. Reload saved messages; completed operations are preserved.",
        );
        throw new Error("Agent failed");
      } finally {
        clearInterval(polling);
        active.delete(`${actor}:${a.turnId}`);
        for (const id of opened) writer.write({ type: "text-end", id });
      }
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({
    stream,
    headers: { "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
