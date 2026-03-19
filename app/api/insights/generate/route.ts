import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateDigest } from "@/lib/ai/digest";

export async function POST(request: NextRequest) {
  const { type, start_date, end_date } = await request.json();

  if (!type || !start_date || !end_date) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const result = await generateDigest(type, start_date, end_date);
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("insights")
    .insert({
      type,
      period_start: start_date,
      period_end: end_date,
      content: result.content,
      summary: result.summary,
      data: result.data,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
