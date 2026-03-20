import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/redbark/webhook";
import { RedbarkWebhookPayload } from "@/lib/redbark/types";
import { createServiceClient } from "@/lib/supabase/server";
import { categoriseTransactions } from "@/lib/ai/categorise";
import { detectAnomalies } from "@/lib/ai/anomaly";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-redbark-signature") ?? "";
  const timestamp = request.headers.get("x-redbark-timestamp") ?? "";
  const deliveryId = request.headers.get("x-redbark-delivery-id") ?? "";
  const secret = process.env.REDBARK_WEBHOOK_SECRET!;

  if (!verifyWebhook(rawBody, signature, timestamp, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload: RedbarkWebhookPayload = JSON.parse(rawBody);

  if (payload.type !== "transactions.synced") {
    return NextResponse.json({ status: "ignored", type: payload.type });
  }

  const supabase = createServiceClient();
  console.log("Redbark webhook transactions.synced", {
    deliveryId,
    syncRunId: payload.metadata.sync_run_id,
    newCount: payload.data.new.length,
    updatedCount: payload.data.updated.length,
  });

  // Upsert accounts and process transactions
  const accountMap = new Map<string, string>();
  const allTransactions = [...payload.data.new, ...payload.data.updated];

  for (const txn of allTransactions) {
    if (!accountMap.has(txn.account)) {
      const institution = txn.account.toLowerCase().includes("up")
        ? "Up Bank"
        : "CommBank";
      const type = txn.account.toLowerCase().includes("saver") ||
        txn.account.toLowerCase().includes("saving")
        ? "savings"
        : txn.account.toLowerCase().includes("invest")
          ? "investment"
          : "transaction";

      const { data: account } = await supabase
        .from("accounts")
        .upsert(
          {
            redbark_name: txn.account,
            institution,
            type,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "redbark_name" }
        )
        .select("id")
        .single();

      if (account) accountMap.set(txn.account, account.id);
    }
  }

  // Insert new transactions
  const newTxns = payload.data.new.map((txn) => ({
    redbark_id: txn.id,
    account_id: accountMap.get(txn.account),
    date: txn.transaction_date,
    description: txn.description,
    amount_cents: txn.amount,
    currency: txn.currency,
    direction: txn.direction,
    status: txn.status,
    merchant: txn.merchant_name,
    redbark_class: txn.class,
    redbark_category: txn.category,
    post_date: txn.post_date,
    raw_data: txn,
  }));

  const insertedIds: string[] = [];

  for (const txn of newTxns) {
    const { data, error } = await supabase
      .from("transactions")
      .upsert(txn, { onConflict: "redbark_id" })
      .select("id, redbark_id")
      .single();

    if (data) insertedIds.push(data.id);
    if (error) console.error("Insert error:", error);
  }

  // Update existing transactions
  for (const txn of payload.data.updated) {
    await supabase
      .from("transactions")
      .update({
        amount_cents: txn.amount,
        status: txn.status,
        description: txn.description,
        merchant: txn.merchant_name,
        redbark_category: txn.category,
        post_date: txn.post_date,
        raw_data: txn,
        updated_at: new Date().toISOString(),
      })
      .eq("redbark_id", txn.id);
  }

  // Return 200 immediately, process AI async
  const response = NextResponse.json({
    status: "ok",
    delivery_id: deliveryId,
    new_count: payload.data.new.length,
    updated_count: payload.data.updated.length,
    chunk: `${payload.metadata.chunk}/${payload.metadata.total_chunks}`,
  });

  // Ensure AI work actually completes (important on Vercel).
  // If we "fire and forget", the serverless runtime may terminate early.
  const aiRunId = randomUUID();
  const aiTransactions = [...payload.data.new, ...payload.data.updated];
  if (aiTransactions.length > 0) {
    try {
      await processAIAsync(supabase, aiTransactions, insertedIds, aiRunId, payload.metadata.sync_run_id);
    } catch (error) {
      console.error("AI webhook processing failed", {
        aiRunId,
        deliveryId,
        syncRunId: payload.metadata.sync_run_id,
        error: String(error),
      });
    }
  } else {
    console.log("AI webhook skipped: no transactions", {
      aiRunId,
      deliveryId,
      syncRunId: payload.metadata.sync_run_id,
    });
  }

  return response;
}

async function processAIAsync(
  supabase: ReturnType<typeof createServiceClient>,
  newTransactions: RedbarkWebhookPayload["data"]["new"],
  insertedIds: string[],
  aiRunId: string,
  syncRunId: string
) {
  const startedAt = Date.now();
  console.log("AI webhook processing start", {
    aiRunId,
    syncRunId,
    txCount: newTransactions.length,
    insertedIdsCount: insertedIds.length,
  });
  // Batch categorise (up to 20 at a time)
  const batches = [];
  for (let i = 0; i < newTransactions.length; i += 20) {
    batches.push(newTransactions.slice(i, i + 20));
  }
  console.log("AI webhook batches prepared", { batchCount: batches.length });

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const toCateg = batch.map((t) => ({
      redbark_id: t.id,
      description: t.description,
      amount_cents: t.amount,
      direction: t.direction,
      merchant: t.merchant_name,
      redbark_category: t.category,
    }));

    console.log("AI categorise batch start", {
      aiRunId,
      batchIndex,
      batchSize: toCateg.length,
    });

    const results = await categoriseTransactions(toCateg, {
      aiRunId,
      batchIndex,
    });
    if (results.length === 0) {
      console.warn("AI categorisation returned no results", {
        aiRunId,
        batchIndex,
        ids: toCateg.map((t) => t.redbark_id).slice(0, 3),
      });
    }

    let updatedOk = 0;
    let updatedMatched0 = 0;
    for (const result of results) {
      const { data: updatedRows, error: updateError } = await supabase
        .from("transactions")
        .update({
          ai_category: result.category,
          ai_confidence: result.confidence,
          is_recurring: result.is_recurring,
          merchant: result.merchant_clean,
        })
        .eq("redbark_id", result.redbark_id)
        .select("id");

      if (updateError) {
        console.error("AI update failed", {
          aiRunId,
          batchIndex,
          redbark_id: result.redbark_id,
          error: updateError,
        });
      }
      if (!updateError && (!updatedRows || updatedRows.length === 0)) {
        updatedMatched0 += 1;
        console.warn("AI update matched 0 rows", {
          aiRunId,
          batchIndex,
          redbark_id: result.redbark_id,
        });
      }
      if (!updateError && updatedRows && updatedRows.length > 0) {
        updatedOk += 1;
      }

      // Anomaly detection
      const { data: txnRow } = await supabase
        .from("transactions")
        .select("id, merchant, amount_cents, date")
        .eq("redbark_id", result.redbark_id)
        .single();

      if (txnRow) {
        const anomalies = await detectAnomalies(
          txnRow.id,
          txnRow.merchant,
          txnRow.amount_cents,
          txnRow.date,
          result.is_recurring
        );

        if (anomalies.length > 0) {
          await supabase
            .from("transactions")
            .update({ is_anomaly: true, anomaly_reason: anomalies[0].description })
            .eq("id", txnRow.id);

          await supabase.from("anomalies").insert(anomalies);
        }
      }
    }

    console.log("AI categorise batch complete", {
      aiRunId,
      batchIndex,
      resultsCount: results.length,
      updatedOk,
      updatedMatched0,
    });
  }
  console.log("AI webhook processing complete", {
    aiRunId,
    txCount: newTransactions.length,
    batchCount: batches.length,
    elapsedMs: Date.now() - startedAt,
  });
}
