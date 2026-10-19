import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { supabase, configured } from "../../../lib/supabase";
import {
  ServiceError,
  WorkspaceService,
} from "../../../../../packages/core/services";

import { isAllowedOrigin } from "../../../lib/origin";

export const runtime = "nodejs";
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
    const service = new WorkspaceService(db, user.id);
    const [resource, workspaceId, child, childId, recordId] = path;
    const method = req.method;
    if (resource === "catalog" && method === "GET")
      return NextResponse.json(service.catalog());
    if (resource !== "workspaces") throw new ServiceError("Not found.", 404);
    let data: unknown;
    if (!workspaceId && method === "GET") data = await service.list();
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
