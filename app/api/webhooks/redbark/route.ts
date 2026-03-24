import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/redbark/webhook";
import { RedbarkWebhookPayload } from "@/lib/redbark/types";
import { createServiceClient } from "@/lib/supabase/server";

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

  // Upsert accounts
  const accountMap = new Map<string, string>();
  const allTransactions = [...payload.data.new, ...payload.data.updated];

  for (const txn of allTransactions) {
    const accountLabel = txn.account_name ?? txn.account;
    if (!accountMap.has(accountLabel)) {
      const institution = accountLabel.toLowerCase().includes("up")
        ? "Up Bank"
        : "CommBank";
      const type = accountLabel.toLowerCase().includes("saver") ||
        accountLabel.toLowerCase().includes("saving")
        ? "savings"
        : accountLabel.toLowerCase().includes("invest")
          ? "investment"
          : "transaction";

      const row: Record<string, unknown> = {
        redbark_name: accountLabel,
        institution,
        type,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (txn.account_id) {
        row.redbark_account_id = txn.account_id;
      }

      const { data: account } = await supabase
        .from("accounts")
        .upsert(row, { onConflict: "redbark_name" })
        .select("id")
        .single();

      if (account) accountMap.set(accountLabel, account.id);
    }
  }

  // Insert new transactions (ai_status defaults to 'pending')
  let insertedCount = 0;
  for (const txn of payload.data.new) {
    const label = txn.account_name ?? txn.account;
    const { error } = await supabase
      .from("transactions")
      .upsert(
        {
          redbark_id: txn.id,
          account_id: accountMap.get(label),
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
          ai_status: "pending",
        },
        { onConflict: "redbark_id" }
      );

    if (error) {
      console.error("Insert error:", error);
    } else {
      insertedCount++;
    }
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

  console.log("Redbark webhook complete", {
    deliveryId,
    insertedCount,
    updatedCount: payload.data.updated.length,
  });

  return NextResponse.json({
    status: "ok",
    delivery_id: deliveryId,
    new_count: insertedCount,
    updated_count: payload.data.updated.length,
    chunk: `${payload.metadata.chunk}/${payload.metadata.total_chunks}`,
  });
}
