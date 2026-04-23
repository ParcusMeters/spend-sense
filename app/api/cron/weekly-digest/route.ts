import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateDigest } from "@/lib/ai/digest";
import { getPreviousWeek } from "@/lib/utils/dates";
import { sendDigestEmail } from "@/lib/email/send";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { start, end } = getPreviousWeek();

  const { data: users } = await supabase
    .from("user_profiles")
    .select("user_id, display_name, monthly_income_cents, savings_goal_cents");

  const results = [];

  for (const profile of users ?? []) {
    try {
      const result = await generateDigest("weekly", start, end, supabase, profile.user_id, {
        displayName: profile.display_name ?? undefined,
        monthlyIncomeCents: profile.monthly_income_cents ?? undefined,
        savingsGoalCents: profile.savings_goal_cents ?? undefined,
      });

      const { data, error } = await supabase
        .from("insights")
        .insert({
          type: "weekly",
          period_start: start,
          period_end: end,
          content: result.content,
          summary: result.summary,
          data: result.data,
          user_id: profile.user_id,
        })
        .select()
        .single();

      if (error) {
        results.push({ user_id: profile.user_id, error: error.message });
        continue;
      }

      const emailResult = await sendDigestEmail({
        subject: `Weekly Digest — ${start} to ${end}`,
        markdown: result.content,
        period: { start, end },
      });

      results.push({ user_id: profile.user_id, insight_id: data.id, email: emailResult });
    } catch (err) {
      results.push({ user_id: profile.user_id, error: String(err) });
    }
  }

  return NextResponse.json({ status: "ok", results });
}
