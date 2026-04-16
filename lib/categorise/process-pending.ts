import { createServiceClient } from "@/lib/supabase/server";
import { detectAnomalies } from "@/lib/ai/anomaly";
import { categoriseTransactions } from "@/lib/ai/categorise";

const BATCH_SIZE = 10;
const MAX_BATCHES_PER_RUN = 5;

export type CategorisePendingRunResult = {
  processed: number;
  failed: number;
  elapsed_ms: number;
  message?: string;
};

export async function processPendingCategorisation(): Promise<CategorisePendingRunResult> {
  const supabase = createServiceClient();
  const startedAt = Date.now();

  const { data: pending, error: fetchError } = await supabase
    .from("transactions")
    .select(
      "id, redbark_id, description, amount_cents, direction, merchant, redbark_category, date"
    )
    .in("ai_status", ["pending", "failed"])
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(BATCH_SIZE * MAX_BATCHES_PER_RUN);

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  if (!pending || pending.length === 0) {
    return {
      processed: 0,
      failed: 0,
      elapsed_ms: Date.now() - startedAt,
      message: "No pending transactions",
    };
  }

  const pendingIds = pending.map((t) => t.id);
  await supabase.from("transactions").update({ ai_status: "processing" }).in("id", pendingIds);

  let totalProcessed = 0;
  let totalFailed = 0;

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
      const resultMap = new Map(results.map((r) => [r.redbark_id, r]));

      for (const txn of batch) {
        const result = resultMap.get(txn.redbark_id);

        if (!result) {
          await supabase.from("transactions").update({ ai_status: "failed" }).eq("id", txn.id);
          totalFailed++;
          continue;
        }

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
          console.error("categorise-pending: anomaly detection failed", {
            txnId: txn.id,
            error: String(anomalyErr),
          });
        }

        totalProcessed++;
      }
    } catch (batchErr) {
      console.error("categorise-pending: batch failed", {
        batchIndex,
        error: String(batchErr),
      });

      const batchIds = batch.map((t) => t.id);
      await supabase.from("transactions").update({ ai_status: "failed" }).in("id", batchIds);
      totalFailed += batch.length;
    }
  }

  return {
    processed: totalProcessed,
    failed: totalFailed,
    elapsed_ms: Date.now() - startedAt,
  };
}
