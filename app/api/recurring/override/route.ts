import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const { account_id, merchant, description, is_recurring } = await request.json();

  if (!account_id || typeof is_recurring !== "boolean") {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (!merchant && !description) {
    return NextResponse.json(
      { error: "Either merchant or description is required" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  let query = supabase
    .from("transactions")
    .update({
      is_recurring,
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", account_id)
    .eq("direction", "debit");

  query = merchant
    ? query.eq("merchant", merchant)
    : query.eq("description", description);

  const { error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status: "ok" });
}

