export const dynamic = "force-dynamic";

import { createUserClient } from "@/lib/supabase/server";
import { AuthGate } from "@/components/auth/AuthGate";
import { SettingsClient } from "./SettingsClient";

async function SettingsContent() {
  const supabase = await createUserClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name, monthly_income_cents, savings_goal_cents, redbark_webhook_secret")
    .eq("user_id", user!.id)
    .maybeSingle();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <SettingsClient
      initialProfile={{
        display_name: profile?.display_name ?? "",
        monthly_income_cents: profile?.monthly_income_cents ?? 0,
        savings_goal_cents: profile?.savings_goal_cents ?? 0,
        webhook_configured: Boolean(profile?.redbark_webhook_secret),
      }}
      appUrl={appUrl}
      userEmail={user!.email ?? ""}
    />
  );
}

export default function SettingsPage() {
  return (
    <AuthGate>
      <SettingsContent />
    </AuthGate>
  );
}
