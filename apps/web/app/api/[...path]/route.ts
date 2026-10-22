import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { supabase, configured } from "../../../src/shared/db/supabase";
import { ServiceError } from "../../../src/shared/db/result";
import { createWorkspaceServices } from "../../../src/composition/services";

import { ConversationService } from "../../../src/features/chat/server/services";
import { createToolRegistry } from "../../../src/composition/tools";
import { ToolExecutor } from "../../../src/features/tooling/server/executor";
import { z } from "zod";

import {
  agentResponse,
  cancelAgent,
  privilegedPersistence,
} from "../../../src/composition/agent-host";
import { ProviderSettingsService } from "../../../src/features/providers/server/settings";
import { isAllowedOrigin } from "../../../src/shared/http/origin";

export const runtime = "nodejs";
export const maxDuration = 300;
async function handle(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    if (!configured())
      return NextResponse.json(
        { error: "Add Supabase configuration to start using PAW." },
        { status: 503 },
      );
    if (req.method !== "GET") {
      const origin = req.headers.get("origin");
      if (
        !isAllowedOrigin(
          origin,
          req.nextUrl.origin,
          req.headers.get("host"),
          process.env.PAW_APP_ORIGIN,
          process.env.NODE_ENV === "development",
        )
      )
        throw new ServiceError("Request origin is not allowed.", 403);
      if (!req.headers.get("content-type")?.startsWith("application/json"))
        throw new ServiceError("Expected JSON.");
    }
    const { path } = await context.params;
    const db = await supabase();
    const body = req.method === "GET" ? {} : await readBody(req);
    if (path[0] === "auth") {
      if (path[1] === "session" && req.method === "GET") {
        const {
          data: { user },
        } = await db.auth.getUser();
        return NextResponse.json(
          { user: user ? { id: user.id, email: user.email } : null },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (req.method !== "POST")
        throw new ServiceError("Method not allowed.", 405);
      if (path[1] === "signout") {
        const { error } = await db.auth.signOut();
        if (error) throw new ServiceError("Unable to sign out. Try again.");
        return NextResponse.json({ ok: true });
      }
      const { z } = await import("zod");
      const credentials = z
        .object({
          email: z.email().max(254),
          password: z.string().min(8).max(128),
        })
        .strict()
        .parse(body);
      const result =
        path[1] === "signup"
          ? await db.auth.signUp(credentials)
          : path[1] === "signin"
            ? await db.auth.signInWithPassword(credentials)
            : null;
      if (!result) throw new ServiceError("Not found.", 404);
      if (result.error)
        throw new ServiceError(
          path[1] === "signin"
            ? "Sign-in failed. Check your credentials and email confirmation."
            : "Unable to sign up. Check your details or try again later.",
        );
      return NextResponse.json({
        authenticated: Boolean(result.data.session),
        message: "Check your email to confirm your account, then sign in.",
      });
    }
    const {
      data: { user },
      error,
    } = await db.auth.getUser();
    if (error || !user) throw new ServiceError("Please sign in.", 401);
    const service = createWorkspaceServices(db, user.id);
    if (path[0] === "ai-settings" && path.length === 1) {
      const settings = new ProviderSettingsService(
        privilegedPersistence(),
        user.id,
      );
      const result =
        req.method === "GET"
          ? await settings.status()
          : req.method === "PUT"
            ? await settings.save(body)
            : req.method === "PATCH"
              ? await settings.select(body)
              : req.method === "DELETE"
                ? await settings.remove(body)
                : null;
      if (!result) throw new ServiceError("Method not allowed.", 405);
      return NextResponse.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (path[0] === "agent" && req.method === "POST") {
      if (path.length === 1)
        return await agentResponse(user.id, body, db, req.signal);
      if (path.length === 2 && path[1] === "cancel")
        return NextResponse.json(await cancelAgent(user.id, body, db));
    }

    // Tool execution is authenticated, bounded and CSRF-protected by the same
    // route boundary as manual operations. Permissions are selected by the host.
    if (path[0] === "tools" && path.length === 1 && req.method === "POST") {
      const request = z
        .object({
          toolId: z.string().max(100),
          arguments: z.record(z.string(), z.json()),
          workspaceId: z.uuid().optional(),
        })
        .strict()
        .parse(body);
      const executor = new ToolExecutor(createToolRegistry(), {
        service,
        workspaceId: request.workspaceId,
        permissions: new Set(["read", "write", "delete"]),
      });
      const result = await executor.execute(request.toolId, request.arguments);
      return NextResponse.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const [resource, workspaceId, child, childId, recordId] = path;
    const method = req.method;
    if (resource === "catalog" && method === "GET")
      return NextResponse.json(service.catalog());
    if (resource !== "workspaces") throw new ServiceError("Not found.", 404);
    let data: unknown;
    if (child === "conversations") {
      if (
        path.length > 5 ||
        (recordId && !["messages", "turns"].includes(recordId))
      )
        throw new ServiceError("Not found.", 404);
      const conversations = new ConversationService(db, service);
      const paging = Object.fromEntries(req.nextUrl.searchParams);
      if (childId && recordId === "turns" && method === "GET") {
        await conversations.conversation(workspaceId, childId);
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
        data = result.data;
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
        if (req.nextUrl.searchParams.has("recent")) {
          const args = z
            .object({
              recent: z.literal("true"),
              before: z.coerce.number().int().positive().optional(),
            })
            .strict()
            .parse(paging);
          data = await conversations.recent(workspaceId, childId, args.before);
        } else
          data = await conversations.messages(workspaceId, childId, paging);
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
    } else if (!workspaceId && method === "GET") data = await service.list();
    else if (!workspaceId && method === "POST")
      data = await service.create(body.name);
    else if (workspaceId && !child) {
      if (method === "GET") data = await service.workspace(workspaceId);
      else if (method === "PATCH")
        data = await service.rename(workspaceId, body.name);
      else if (method === "DELETE") {
        await service.remove(workspaceId, body.confirmed);
        data = { ok: true };
      } else throw new ServiceError("Method not allowed.", 405);
    } else if (child === "interface" && method === "GET")
      data = await service.inspect(workspaceId);
    else if (child === "interface" && method === "PATCH")
      data = await service.applyInterfaceMessages(
        workspaceId,
        body.messages,
        body.revision,
      );
    else if (child === "collections" && !childId && method === "GET")
      data = await service.collections(workspaceId);
    else if (child === "collections" && !childId && method === "POST")
      data = await service.createCollection(workspaceId, body);
    else if (
      child === "collections" &&
      childId &&
      recordId === "aggregate" &&
      method === "GET"
    )
      data = await service.aggregate(
        workspaceId,
        childId,
        req.nextUrl.searchParams.get("field") || "",
      );
    else if (
      child === "collections" &&
      childId &&
      !recordId &&
      method === "GET"
    )
      data = await service.records(
        workspaceId,
        childId,
        Object.fromEntries(req.nextUrl.searchParams),
      );
    else if (
      child === "collections" &&
      childId &&
      !recordId &&
      method === "POST"
    )
      data = await service.writeRecord(workspaceId, childId, body.data);
    else if (
      child === "collections" &&
      childId &&
      recordId &&
      method === "PATCH"
    )
      data = await service.writeRecord(
        workspaceId,
        childId,
        body.data,
        recordId,
        body.updatedAt,
      );
    else if (
      child === "collections" &&
      childId &&
      recordId &&
      method === "DELETE"
    ) {
      await service.deleteRecord(
        workspaceId,
        childId,
        recordId,
        body.confirmed,
      );
      data = { ok: true };
    } else if (child === "interface" && method === "PUT")
      data = await service.saveInterface(
        workspaceId,
        body.definition,
        body.revision,
      );
    else if (child === "revisions" && method === "GET")
      data = await service.revisions(workspaceId);
    else throw new ServiceError("Not found.", 404);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status =
      error instanceof ServiceError
        ? error.status
        : error instanceof ZodError || error instanceof SyntaxError
          ? 400
          : 500;
    const message =
      error instanceof ZodError
        ? error.issues
            .map((i) => `${i.path.join(".") || "Input"}: ${i.message}`)
            .join("; ")
        : error instanceof ServiceError
          ? error.message
          : status === 400
            ? "Invalid JSON."
            : "Something went wrong. Please retry.";
    return NextResponse.json(
      { error: message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
async function readBody(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader) throw new ServiceError("Request body is required.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 350000) {
      await reader.cancel();
      throw new ServiceError("Request is too large.", 413);
    }
    chunks.push(value);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ServiceError("Expected a JSON object.");
  return body;
}
export {
  handle as GET,
  handle as POST,
  handle as PATCH,
  handle as PUT,
  handle as DELETE,
};
