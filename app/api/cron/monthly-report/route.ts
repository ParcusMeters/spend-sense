import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateDigest } from "@/lib/ai/digest";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lastMonth = subMonths(new Date(), 1);
  const start = format(startOfMonth(lastMonth), "yyyy-MM-dd");
  const end = format(endOfMonth(lastMonth), "yyyy-MM-dd");

  const result = await generateDigest("monthly", start, end);
  const supabase = createServiceClient();

  // Store insight
  const { data: insight } = await supabase
    .from("insights")
    .insert({
      type: "monthly",
      period_start: start,
      period_end: end,
      content: result.content,
      summary: result.summary,
      data: result.data,
    })
    .select()
    .single();

  // Update monthly summary
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
    },
    { onConflict: "month" }
  );

  return NextResponse.json({ status: "ok", insight_id: insight?.id });
}
