import type { SupabaseClient } from "@supabase/supabase-js";
import "server-only";
import { ServiceError } from "../../../shared/db/result";
import type { FeatureRequest } from "../../../shared/http/request";
import { json } from "../../../shared/http/response";
export async function handleAuth(req: FeatureRequest, db: SupabaseClient) {
  const { path, body } = req;
  if (path[1] === "session" && req.method === "GET") {
    const {
      data: { user },
    } = await db.auth.getUser();
    return json(
      { user: user ? { id: user.id, email: user.email } : null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (req.method !== "POST") throw new ServiceError("Method not allowed.", 405);
  if (path[1] === "signout") {
    const { error } = await db.auth.signOut();
    if (error) throw new ServiceError("Unable to sign out. Try again.");
    return json({ ok: true });
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
  return json({
    authenticated: Boolean(result.data.session),
    message: "Check your email to confirm your account, then sign in.",
  });
}
