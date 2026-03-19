import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/redbark/webhook";
import { RedbarkWebhookPayload } from "@/lib/redbark/types";
import { createServiceClient } from "@/lib/supabase/server";
import { categoriseTransactions } from "@/lib/ai/categorise";
import { detectAnomalies } from "@/lib/ai/anomaly";

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

  // Fire and forget: AI categorisation + anomaly detection
  if (payload.data.new.length > 0) {
    processAIAsync(supabase, payload.data.new, insertedIds).catch(console.error);
  }

  return response;
}

async function processAIAsync(
  supabase: ReturnType<typeof createServiceClient>,
  newTransactions: RedbarkWebhookPayload["data"]["new"],
  insertedIds: string[]
) {
  // Batch categorise (up to 20 at a time)
  const batches = [];
  for (let i = 0; i < newTransactions.length; i += 20) {
    batches.push(newTransactions.slice(i, i + 20));
  }

  for (const batch of batches) {
    const toCateg = batch.map((t) => ({
      redbark_id: t.id,
      description: t.description,
      amount_cents: t.amount,
      direction: t.direction,
      merchant: t.merchant_name,
      redbark_category: t.category,
    }));

    const results = await categoriseTransactions(toCateg);

    for (const result of results) {
      await supabase
        .from("transactions")
        .update({
          ai_category: result.category,
          ai_confidence: result.confidence,
          is_recurring: result.is_recurring,
          merchant: result.merchant_clean,
        })
        .eq("redbark_id", result.redbark_id);

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
  }
}
