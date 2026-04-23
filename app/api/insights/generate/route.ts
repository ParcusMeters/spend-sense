import { NextRequest, NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { generateDigest } from "@/lib/ai/digest";

export async function POST(request: NextRequest) {
  try {
    const { type, start_date, end_date } = await request.json();

    if (!type || !start_date || !end_date) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const supabase = await createUserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("display_name, monthly_income_cents, savings_goal_cents")
      .eq("user_id", user.id)
      .maybeSingle();

    let result;
    try {
      result = await generateDigest(type, start_date, end_date, supabase, user.id, {
        displayName: profile?.display_name ?? undefined,
        monthlyIncomeCents: profile?.monthly_income_cents ?? undefined,
        savingsGoalCents: profile?.savings_goal_cents ?? undefined,
      });
    } catch (error) {
      console.error("AI insights generateDigest failed", { type, start_date, end_date, error: String(error) });
      return NextResponse.json(
        { error: "Failed to generate digest", details: String(error) },
        { status: 500 }
      );
    }

    const { data, error } = await supabase
      .from("insights")
      .insert({
        type,
        period_start: start_date,
        period_end: end_date,
        content: result.content,
        summary: result.summary,
        data: result.data,
        user_id: user.id,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("AI insights generate route crashed", { error: String(error) });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
