import Dashboard from "../src/composition/Dashboard";
import { configured } from "../src/shared/db/supabase";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Dashboard configured={configured()} />;
}
