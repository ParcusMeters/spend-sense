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

  const { start, end } = getPreviousWeek();
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

  const email = await sendDigestEmail({
    subject: `Weekly Digest — ${start} to ${end}`,
    markdown: result.content,
    period: { start, end },
  });

  return NextResponse.json({ status: "ok", insight_id: data.id, email });
}
