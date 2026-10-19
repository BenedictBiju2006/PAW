import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Resolve on the server at runtime, so deployment variables can change after a build.
const readEnv = (name: string) => process.env[name];
export function configured() {
  return Boolean(
    readEnv("NEXT_PUBLIC_SUPABASE_URL") &&
    (readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
      readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")),
  );
}
export async function supabase() {
  const jar = await cookies();
  if (!configured()) throw new Error("Supabase is not configured.");
  return createServerClient(
    readEnv("NEXT_PUBLIC_SUPABASE_URL")!,
    (readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
      readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"))!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) => {
          values.forEach(({ name, value, options }) =>
            jar.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
            }),
          );
        },
      },
    },
  );
}
