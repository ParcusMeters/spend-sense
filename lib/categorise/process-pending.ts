import { createServiceClient } from "@/lib/supabase/server";
import { detectAnomaliesForBatch } from "@/lib/ai/anomaly";
import { categoriseTransactions } from "@/lib/ai/categorise";

const BATCH_SIZE = 10;
/** How many row writes in a batch are issued at once. */
const FINALISE_CONCURRENCY = 10;

/**
 * Conservative first guess at batch cost, used before a real one is observed.
 * The deadline check is predictive — it asks whether the *next* batch would finish
 * in time, because stopping only once the clock has already run out overshoots by
 * a full batch and defeats the point of the budget.
 */
const INITIAL_BATCH_ESTIMATE_MS = 25_000;

/** Run `worker` over `items`, at most `limit` in flight. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}
/**
 * A run that dies mid-flight (function timeout, redeploy) leaves rows marked
 * 'processing'. Nothing else selects that state, so without this they would never
 * be categorised again.
 *
 * Rows are claimed one batch at a time, so a hard kill can strand at most
 * BATCH_SIZE rows, and only until the next run sweeps them up.
 */
const STALE_PROCESSING_MS = 15 * 60 * 1000;

export type CategorisePendingOptions = {
  /**
   * Epoch ms after which no new batch is started. The call returns cleanly with
   * whatever is left so the caller can come back for more — this is what keeps a
   * large queue from running into the function timeout.
   */
  deadline?: number;
  /** Upper bound on transactions handled in this call. */
  maxTransactions?: number;
};

export type CategorisePendingRunResult = {
  processed: number;
  failed: number;
  elapsed_ms: number;
  /** Transactions still needing categorisation after this call. */
  remaining: number;
  stopped_reason: "complete" | "deadline" | "limit";
  message?: string;
};

export async function processPendingCategorisation(
  options?: CategorisePendingOptions
): Promise<CategorisePendingRunResult> {
  const supabase = createServiceClient();
  const startedAt = Date.now();
  const deadline = options?.deadline ?? Number.POSITIVE_INFINITY;
  const maxTransactions = options?.maxTransactions ?? Number.POSITIVE_INFINITY;

  // Reclaim rows abandoned by a previous run before deciding what is outstanding.
  const staleBefore = new Date(startedAt - STALE_PROCESSING_MS).toISOString();
  const { data: recovered, error: recoverError } = await supabase
    .from("transactions")
    .update({ ai_status: "pending", updated_at: new Date().toISOString() })
    .eq("ai_status", "processing")
    .lt("updated_at", staleBefore)
    .select("id");

  if (recoverError) {
    console.error("categorise-pending: failed to requeue stale processing rows", recoverError);
  } else if (recovered && recovered.length > 0) {
    console.warn("categorise-pending: requeued stale processing rows", {
      count: recovered.length,
    });
  }

  // Retry earlier failures once per call. Promoting them up front lets the loop
  // below select only 'pending', so a row that fails again inside this call is not
  // immediately picked back up and cannot spin.
  const { error: retryError } = await supabase
    .from("transactions")
    .update({ ai_status: "pending", updated_at: new Date().toISOString() })
    .eq("ai_status", "failed");

  if (retryError) {
    console.error("categorise-pending: failed to requeue failed rows", retryError);
  }

  let totalProcessed = 0;
  let totalFailed = 0;
  let batchIndex = 0;
  let longestBatchMs = INITIAL_BATCH_ESTIMATE_MS;
  let stoppedReason: CategorisePendingRunResult["stopped_reason"] = "complete";

  for (;;) {
    // Always allow the first batch, otherwise a tight budget makes no progress at
    // all. After that, only start one that is expected to finish in time.
    if (batchIndex > 0 && Date.now() + longestBatchMs > deadline) {
      stoppedReason = "deadline";
      break;
    }
    if (totalProcessed + totalFailed >= maxTransactions) {
      stoppedReason = "limit";
      break;
    }

    const { data: batch, error: fetchError } = await supabase
      .from("transactions")
      .select(
        "id, redbark_id, description, amount_cents, direction, merchant, redbark_category, date"
      )
      .eq("ai_status", "pending")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(BATCH_SIZE);

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    if (!batch || batch.length === 0) {
      stoppedReason = "complete";
      break;
    }

    // Claim only this batch. updated_at is stamped explicitly (no DB trigger
    // maintains it) so the stale sweep can tell a live run from an abandoned one.
    const batchIds = batch.map((t) => t.id);
    const { error: claimError } = await supabase
      .from("transactions")
      .update({ ai_status: "processing", updated_at: new Date().toISOString() })
      .in("id", batchIds);

    if (claimError) {
      throw new Error(claimError.message);
    }

    const batchStartedAt = Date.now();

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

      // Anomaly detection for the whole batch: at most one model call, and none
      // when nothing shows a signal. Done before the writes so each row's update
      // and its anomaly flag land together.
      const categorised = batch.flatMap((txn) => {
        const result = resultMap.get(txn.redbark_id);
        return result
          ? [
              {
                transactionId: txn.id,
                merchant: result.merchant_clean,
                amountCents: txn.amount_cents,
                date: txn.date,
                isRecurring: result.is_recurring,
              },
            ]
          : [];
      });

      const anomaliesByTxn = await detectAnomaliesForBatch(categorised);

      const outcomes = await mapWithConcurrency(
        batch,
        FINALISE_CONCURRENCY,
        async (txn): Promise<"processed" | "failed"> => {
          const result = resultMap.get(txn.redbark_id);

          if (!result) {
            await supabase
              .from("transactions")
              .update({ ai_status: "failed", updated_at: new Date().toISOString() })
              .eq("id", txn.id);
            return "failed";
          }

          await supabase
            .from("transactions")
            .update({
              ai_category: result.category,
              ai_confidence: result.confidence,
              is_recurring: result.is_recurring,
              merchant: result.merchant_clean,
              ai_status: "done",
              updated_at: new Date().toISOString(),
            })
            .eq("id", txn.id);

          const anomalies = anomaliesByTxn.get(txn.id) ?? [];
          if (anomalies.length > 0) {
            try {
              await supabase
                .from("transactions")
                .update({ is_anomaly: true, anomaly_reason: anomalies[0].description })
                .eq("id", txn.id);

              await supabase.from("anomalies").insert(anomalies);
            } catch (anomalyErr) {
              // The transaction is already categorised; failing to record an
              // anomaly is not a reason to redo the categorisation.
              console.error("categorise-pending: recording anomaly failed", {
                txnId: txn.id,
                error: String(anomalyErr),
              });
            }
          }

          return "processed";
        }
      );

      for (const outcome of outcomes) {
        if (outcome === "processed") totalProcessed++;
        else totalFailed++;
      }
    } catch (batchErr) {
      console.error("categorise-pending: batch failed", {
        batchIndex,
        error: String(batchErr),
      });

      await supabase
        .from("transactions")
        .update({ ai_status: "failed", updated_at: new Date().toISOString() })
        .in("id", batchIds);
      totalFailed += batch.length;
    }

    longestBatchMs = Math.max(longestBatchMs, Date.now() - batchStartedAt);
    batchIndex++;
  }

  const { count: remainingCount } = await supabase
    .from("transactions")
    .select("*", { count: "exact", head: true })
    .in("ai_status", ["pending", "failed"]);

  const result: CategorisePendingRunResult = {
    processed: totalProcessed,
    failed: totalFailed,
    elapsed_ms: Date.now() - startedAt,
    remaining: remainingCount ?? 0,
    stopped_reason: stoppedReason,
  };

  if (totalProcessed === 0 && totalFailed === 0 && stoppedReason === "complete") {
    result.message = "No pending transactions";
  }

  console.log("categorise-pending: run finished", result);
  return result;
}
