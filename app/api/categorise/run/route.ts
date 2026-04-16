import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { processPendingCategorisation } from "@/lib/categorise/process-pending";

const DEFAULT_MAX_ROUNDS = 20;
const HARD_MAX_ROUNDS = 100;

async function isAuthenticated(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return false;

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );

  const { data, error } = await supabase.auth.getUser(token);
  if (error) return false;
  return Boolean(data.user);
}

export async function POST(request: NextRequest) {
  const authed = await isAuthenticated(request);
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({} as { maxRounds?: number }));
  const requestedRounds = Number(body?.maxRounds);
  const maxRounds = Number.isFinite(requestedRounds)
    ? Math.max(1, Math.min(HARD_MAX_ROUNDS, Math.floor(requestedRounds)))
    : DEFAULT_MAX_ROUNDS;

  let totalProcessed = 0;
  let totalFailed = 0;
  let rounds = 0;

  while (rounds < maxRounds) {
    rounds += 1;
    const result = await processPendingCategorisation();
    totalProcessed += result.processed;
    totalFailed += result.failed;

    if (result.processed === 0 && result.failed === 0) {
      return NextResponse.json({
        status: "ok",
        rounds,
        processed: totalProcessed,
        failed: totalFailed,
        message: "No pending transactions",
      });
    }
  }

  return NextResponse.json({
    status: "partial",
    rounds,
    processed: totalProcessed,
    failed: totalFailed,
    message: `Stopped after ${maxRounds} rounds`,
  });
}
