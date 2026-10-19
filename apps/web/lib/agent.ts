import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { z } from "zod";
import {
  ServiceError,
  WorkspaceService,
} from "../../../packages/core/services";
import { ConversationService } from "../../../packages/conversations/services";
import { ProviderSettingsService } from "../../../packages/agent/settings";
import { AgentStore } from "../../../packages/agent/store";
import { AgentOrchestrator } from "../../../packages/agent/orchestrator";
import { modelHistory } from "../../../packages/agent/context";
import { openaiProvider } from "../../../packages/agent/providers/openai";
import { createToolRegistry } from "../../../packages/tools/definitions";
import { ToolExecutor } from "../../../packages/tools/executor";
const active = new Map<string, AbortController>();
// Match the authenticated client: resolve the URL at runtime, since Next inlines
// direct NEXT_PUBLIC_* property access during the production build.
const readEnv = (name: string) => process.env[name];
export function privilegedPersistence() {
  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new ServiceError(
      "AI persistence is disabled. Configure a server-only Supabase secret key.",
      503,
    );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function cancelAgent(
  actor: string,
  input: unknown,
  userDb: SupabaseClient,
) {
  const a = z
    .object({
      turnId: z.uuid(),
      workspaceId: z.uuid(),
      conversationId: z.uuid(),
    })
    .strict()
    .parse(input);
  await new ConversationService(
    userDb,
    new WorkspaceService(userDb, actor),
  ).conversation(a.workspaceId, a.conversationId);
  const admin = privilegedPersistence();
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
  userDb: SupabaseClient,
  requestSignal: AbortSignal,
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
  const service = new WorkspaceService(userDb, actor),
    conversations = new ConversationService(userDb, service);
  await conversations.conversation(a.workspaceId, a.conversationId);
  const admin = privilegedPersistence(),
    settings = await new ProviderSettingsService(admin, actor).resolve();
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
        const executor = new ToolExecutor(createToolRegistry(), {
          service,
          workspaceId: a.workspaceId,
          permissions: new Set(["read", "write", "delete"]),
        });
        await new AgentOrchestrator(openaiProvider, executor, store).run(
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
