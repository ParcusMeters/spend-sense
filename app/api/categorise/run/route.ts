import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { processPendingCategorisation } from "@/lib/categorise/process-pending";

/**
 * How long a single request spends categorising before returning what is left.
 *
 * Deliberately well under the platform function timeout: an earlier version looped
 * until the whole queue was done, which meant a large backlog always ran past the
 * limit and was killed mid-write. The client comes back for the remainder instead.
 */
const DEFAULT_BUDGET_MS = 35_000;
const MAX_BUDGET_MS = 50_000;
const MIN_BUDGET_MS = 5_000;

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

  const body = await request.json().catch(() => ({}) as { budgetMs?: number });
  const requestedBudget = Number(body?.budgetMs);
  const budgetMs = Number.isFinite(requestedBudget)
    ? Math.max(MIN_BUDGET_MS, Math.min(MAX_BUDGET_MS, Math.floor(requestedBudget)))
    : DEFAULT_BUDGET_MS;

  try {
    const result = await processPendingCategorisation({
      deadline: Date.now() + budgetMs,
    });

    return NextResponse.json({
      status: "ok",
      processed: result.processed,
      failed: result.failed,
      remaining: result.remaining,
      // The caller should send another request to continue where this one stopped.
      hasMore: result.remaining > 0,
      stoppedReason: result.stopped_reason,
      elapsedMs: result.elapsed_ms,
      message: result.message,
    });
  } catch (error) {
    console.error("categorise/run failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
