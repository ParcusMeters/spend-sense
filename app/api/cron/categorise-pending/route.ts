import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { categoriseTransactions } from "@/lib/ai/categorise";
import { detectAnomalies } from "@/lib/ai/anomaly";

const BATCH_SIZE = 10;
const MAX_BATCHES_PER_RUN = 5; // Process up to 50 txns per cron invocation

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startedAt = Date.now();

  // Pending/failed: newest bank transaction dates first, then work backwards
  const { data: pending, error: fetchError } = await supabase
    .from("transactions")
    .select("id, redbark_id, description, amount_cents, direction, merchant, redbark_category, date")
    .in("ai_status", ["pending", "failed"])
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(BATCH_SIZE * MAX_BATCHES_PER_RUN);

  if (fetchError) {
    console.error("categorise-pending: fetch error", fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!pending || pending.length === 0) {
    return NextResponse.json({ status: "ok", processed: 0, message: "No pending transactions" });
  }

  console.log("categorise-pending: starting", { count: pending.length });

  // Mark as processing so they don't get picked up by a concurrent run
  const pendingIds = pending.map((t) => t.id);
  await supabase
    .from("transactions")
    .update({ ai_status: "processing" })
    .in("id", pendingIds);

  let totalProcessed = 0;
  let totalFailed = 0;

  // Process in batches
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const batchIndex = Math.floor(i / BATCH_SIZE);

    const toCateg = batch.map((t) => ({
      redbark_id: t.redbark_id,
      description: t.description,
      amount_cents: t.amount_cents,
      direction: t.direction,
      merchant: t.merchant,
      redbark_category: t.redbark_category,
    }));

    try {
      const results = await categoriseTransactions(toCateg, { batchIndex });

      // Build a lookup for results
      const resultMap = new Map(results.map((r) => [r.redbark_id, r]));

      for (const txn of batch) {
        const result = resultMap.get(txn.redbark_id);

        if (!result) {
          // AI didn't return a result for this transaction
          await supabase
            .from("transactions")
            .update({ ai_status: "failed" })
            .eq("id", txn.id);
          totalFailed++;
          continue;
        }

        // Update with AI categorisation
        await supabase
          .from("transactions")
          .update({
            ai_category: result.category,
            ai_confidence: result.confidence,
            is_recurring: result.is_recurring,
            merchant: result.merchant_clean,
            ai_status: "done",
          })
          .eq("id", txn.id);

        // Anomaly detection
        try {
          const anomalies = await detectAnomalies(
            txn.id,
            result.merchant_clean,
            txn.amount_cents,
            txn.date,
            result.is_recurring
          );

          if (anomalies.length > 0) {
            await supabase
              .from("transactions")
              .update({ is_anomaly: true, anomaly_reason: anomalies[0].description })
              .eq("id", txn.id);

            await supabase.from("anomalies").insert(anomalies);
          }
        } catch (anomalyErr) {
          // Don't fail the whole transaction if anomaly detection fails
          console.error("categorise-pending: anomaly detection failed", {
            txnId: txn.id,
            error: String(anomalyErr),
          });
        }

        totalProcessed++;
      }
    } catch (batchErr) {
      // If the whole batch fails, mark all as failed so they get retried
      console.error("categorise-pending: batch failed", {
        batchIndex,
        error: String(batchErr),
      });

      const batchIds = batch.map((t) => t.id);
      await supabase
        .from("transactions")
        .update({ ai_status: "failed" })
        .in("id", batchIds);

      totalFailed += batch.length;
    }
  }

  const elapsed = Date.now() - startedAt;
  console.log("categorise-pending: complete", {
    totalProcessed,
    totalFailed,
    elapsedMs: elapsed,
  });

  return NextResponse.json({
    status: "ok",
    processed: totalProcessed,
    failed: totalFailed,
    elapsed_ms: elapsed,
  });
}
