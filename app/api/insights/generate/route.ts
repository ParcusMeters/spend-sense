import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateDigest } from "@/lib/ai/digest";

export async function POST(request: NextRequest) {
  try {
    const { type, start_date, end_date } = await request.json();

    console.log("AI insights generate request", {
      type,
      start_date,
      end_date,
    });

    if (!type || !start_date || !end_date) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    let result;
    try {
      result = await generateDigest(type, start_date, end_date);
    } catch (error) {
      console.error("AI insights generateDigest failed", {
        type,
        start_date,
        end_date,
        error: String(error),
      });
      return NextResponse.json(
        { error: "Failed to generate digest", details: String(error) },
        { status: 500 },
      );
    }

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
      console.error("AI insights insert into insights failed", {
        type,
        start_date,
        end_date,
        error,
      });
      return NextResponse.json(
        { error: error.message, details: { code: error.code } },
        { status: 500 },
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("AI insights generate route crashed", {
      error: String(error),
    });
    return NextResponse.json(
      { error: "Internal Server Error", details: String(error) },
      { status: 500 },
    );
  }
}
