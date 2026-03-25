import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("spending_budgets")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ budget: data });
}

export async function PUT(req: NextRequest) {
  const supabase = createServiceClient();
  const { weekly_limit_cents } = await req.json();

  if (typeof weekly_limit_cents !== "number" || weekly_limit_cents < 0) {
    return NextResponse.json({ error: "Invalid weekly_limit_cents" }, { status: 400 });
  }

  // Check if a budget row exists
  const { data: existing } = await supabase
    .from("spending_budgets")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("spending_budgets")
      .update({ weekly_limit_cents, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ budget: data });
  } else {
    const { data, error } = await supabase
      .from("spending_budgets")
      .insert({ weekly_limit_cents })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ budget: data });
  }
}
