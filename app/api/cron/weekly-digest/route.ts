import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateDigest } from "@/lib/ai/digest";
import { getCurrentWeek } from "@/lib/utils/dates";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { start, end } = getCurrentWeek();
  const result = await generateDigest("weekly", start, end);
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("insights")
    .insert({
      type: "weekly",
      period_start: start,
      period_end: end,
      content: result.content,
      summary: result.summary,
      data: result.data,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status: "ok", insight_id: data.id });
}
