import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Counts by ai_status, for the live categorisation indicator.
 *
 * Head-only counts, so this stays cheap enough to poll while a run is in flight.
 */
export async function GET() {
  const supabase = createServiceClient();

  const countByStatus = async (status: string) => {
    const { count, error } = await supabase
      .from("transactions")
      .select("*", { count: "exact", head: true })
      .eq("ai_status", status);
    if (error) throw new Error(`${status}: ${error.message}`);
    return count ?? 0;
  };

  try {
    const [pending, processing, failed, done] = await Promise.all([
      countByStatus("pending"),
      countByStatus("processing"),
      countByStatus("failed"),
      countByStatus("done"),
    ]);

    return NextResponse.json({
      pending,
      processing,
      failed,
      done,
      remaining: pending + processing + failed,
      total: pending + processing + failed + done,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
