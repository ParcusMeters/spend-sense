import { NextRequest, NextResponse } from "next/server";
import { processPendingCategorisation } from "@/lib/categorise/process-pending";

/**
 * Bounded so a large backlog cannot run the cron invocation into the function
 * timeout; anything left over is picked up by the next run or a manual trigger.
 */
const CRON_BUDGET_MS = 45_000;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processPendingCategorisation({
      deadline: Date.now() + CRON_BUDGET_MS,
    });
    return NextResponse.json({ status: "ok", ...result });
  } catch (error) {
    console.error("categorise-pending: failed", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
