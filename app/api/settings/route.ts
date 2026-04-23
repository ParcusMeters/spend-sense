import { NextRequest, NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("user_profiles")
    .select("display_name, monthly_income_cents, savings_goal_cents, redbark_webhook_secret")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    display_name: data?.display_name ?? "",
    monthly_income_cents: data?.monthly_income_cents ?? 0,
    savings_goal_cents: data?.savings_goal_cents ?? 0,
    webhook_configured: Boolean(data?.redbark_webhook_secret),
  });
}

export async function PUT(request: NextRequest) {
  const supabase = await createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.display_name === "string") {
    update.display_name = body.display_name.trim() || null;
  }
  if (typeof body.monthly_income_cents === "number") {
    update.monthly_income_cents = Math.max(0, Math.round(body.monthly_income_cents));
  }
  if (typeof body.savings_goal_cents === "number") {
    update.savings_goal_cents = Math.max(0, Math.round(body.savings_goal_cents));
  }
  if (typeof body.redbark_webhook_secret === "string") {
    update.redbark_webhook_secret = body.redbark_webhook_secret.trim() || null;
  }

  const { error } = await supabase
    .from("user_profiles")
    .update(update)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
