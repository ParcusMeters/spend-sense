import { NextRequest, NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { processPendingCategorisation } from "@/lib/categorise/process-pending";

const DEFAULT_MAX_ROUNDS = 20;
const HARD_MAX_ROUNDS = 100;

export async function POST(request: NextRequest) {
  const supabase = await createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    const result = await processPendingCategorisation(supabase, user.id);
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
