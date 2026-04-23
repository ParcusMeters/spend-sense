import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateDigest } from "@/lib/ai/digest";
import { sendDigestEmail } from "@/lib/email/send";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const lastMonth = subMonths(new Date(), 1);
  const start = format(startOfMonth(lastMonth), "yyyy-MM-dd");
  const end = format(endOfMonth(lastMonth), "yyyy-MM-dd");
  const monthLabel = format(lastMonth, "MMMM yyyy");

  const { data: users } = await supabase
    .from("user_profiles")
    .select("user_id, display_name, monthly_income_cents, savings_goal_cents");

  const results = [];

  for (const profile of users ?? []) {
    try {
      const result = await generateDigest("monthly", start, end, supabase, profile.user_id, {
        displayName: profile.display_name ?? undefined,
        monthlyIncomeCents: profile.monthly_income_cents ?? undefined,
        savingsGoalCents: profile.savings_goal_cents ?? undefined,
      });

      const { data: insight } = await supabase
        .from("insights")
        .insert({
          type: "monthly",
          period_start: start,
          period_end: end,
          content: result.content,
          summary: result.summary,
          data: result.data,
          user_id: profile.user_id,
        })
        .select()
        .single();

      const summaryData = result.data as Record<string, unknown>;
      await supabase.from("monthly_summaries").upsert(
        {
          month: format(startOfMonth(lastMonth), "yyyy-MM-dd"),
          total_income: ((summaryData.total_income as number) ?? 0) / 100,
          total_spending: ((summaryData.total_spending as number) ?? 0) / 100,
          total_saved: ((summaryData.net_saved as number) ?? 0) / 100,
          savings_rate:
            (summaryData.total_income as number) > 0
              ? (summaryData.net_saved as number) / (summaryData.total_income as number)
              : 0,
          category_breakdown: summaryData.category_breakdown as Record<string, number>,
          transaction_count: summaryData.transaction_count as number,
          user_id: profile.user_id,
        },
        { onConflict: "month,user_id" }
      );

      const emailResult = await sendDigestEmail({
        subject: `Monthly Report — ${monthLabel}`,
        markdown: result.content,
        period: { start, end },
      });

      results.push({ user_id: profile.user_id, insight_id: insight?.id, email: emailResult });
    } catch (err) {
      results.push({ user_id: profile.user_id, error: String(err) });
    }
  }

  return NextResponse.json({ status: "ok", results });
}
