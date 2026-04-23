import { NextRequest, NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const { transaction_id, category } = await request.json();

  if (!transaction_id || !category) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const supabase = await createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("transactions")
    .update({
      user_category_override: category,
      updated_at: new Date().toISOString(),
    })
    .eq("id", transaction_id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status: "ok" });
}
