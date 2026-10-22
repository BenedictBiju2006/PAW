import { createClient } from "@supabase/supabase-js";
import "server-only";
import { ServiceError } from "./result";
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
