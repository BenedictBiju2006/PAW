import Dashboard from "./workspace";
import { configured } from "../lib/supabase";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Dashboard configured={configured()} />;
}
