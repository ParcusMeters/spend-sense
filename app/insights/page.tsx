export const dynamic = "force-dynamic";

import { createUserClient } from "@/lib/supabase/server";
import { InsightsClient } from "./InsightsClient";

export default async function InsightsPage() {
  const supabase = await createUserClient();

  const { data: insights } = await supabase
    .from("insights")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  return <InsightsClient insights={insights ?? []} />;
}
