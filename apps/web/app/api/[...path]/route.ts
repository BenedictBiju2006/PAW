import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { supabase, configured } from "../../../src/shared/db/supabase";
import { ServiceError } from "../../../src/shared/db/result";
import { isAllowedOrigin } from "../../../src/shared/http/origin";
import { handleAuth } from "../../../src/features/auth/server/public";
import { dispatchAuthenticated } from "../../../src/composition/http";
import { json } from "../../../src/shared/http/response";
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
    const request = {
      method: req.method,
      path,
      body,
      query: req.nextUrl.searchParams,
      signal: req.signal,
    };
    if (path[0] === "auth") return await handleAuth(request, db);
    const {
      data: { user },
      error,
    } = await db.auth.getUser();
    if (error || !user) throw new ServiceError("Please sign in.", 401);
    const data = await dispatchAuthenticated(request, db, user.id);
    return data instanceof Response ? data : json(data);
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
  return body as Record<string, unknown>;
}
export {
  handle as GET,
  handle as POST,
  handle as PATCH,
  handle as PUT,
  handle as DELETE,
};
