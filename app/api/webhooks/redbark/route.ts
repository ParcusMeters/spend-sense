import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/redbark/webhook";
import type { RedbarkTransaction } from "@/lib/redbark/types";
import { createServiceClient } from "@/lib/supabase/server";

function centsToAud(cents: number): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function summarizeBatch(txns: RedbarkTransaction[]) {
  if (txns.length === 0) {
    return {
      count: 0,
      debitTotalCents: 0,
      creditTotalCents: 0,
      dateRange: null as { min: string; max: string } | null,
      bankCategoryCounts: {} as Record<string, number>,
    };
  }
  let debitTotalCents = 0;
  let creditTotalCents = 0;
  let min = txns[0].transaction_date;
  let max = txns[0].transaction_date;
  const bankCategoryCounts: Record<string, number> = {};
  for (const t of txns) {
    if (t.direction === "debit") debitTotalCents += Math.abs(t.amount);
    else creditTotalCents += Math.abs(t.amount);
    if (t.transaction_date < min) min = t.transaction_date;
    if (t.transaction_date > max) max = t.transaction_date;
    const c = t.category ?? "(no bank category)";
    bankCategoryCounts[c] = (bankCategoryCounts[c] ?? 0) + 1;
  }
  return {
    count: txns.length,
    debitTotalCents,
    creditTotalCents,
    dateRange: { min, max },
    bankCategoryCounts,
  };
}

function txnPreview(t: RedbarkTransaction) {
  return {
    id: t.id,
    date: t.transaction_date,
    direction: t.direction,
    amountAud: centsToAud(t.amount),
    description:
      t.description.length > 100 ? `${t.description.slice(0, 100)}…` : t.description,
    account: t.account_name ?? t.account,
    redbarkAccountId: t.account_id ?? null,
    bankCategory: t.category,
    merchant: t.merchant_name,
    class: t.class,
  };
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const rawBody = await request.text();
  const signature = request.headers.get("x-redbark-signature") ?? "";
  const timestamp = request.headers.get("x-redbark-timestamp") ?? "";
  const deliveryId = request.headers.get("x-redbark-delivery-id") ?? "";
  const userAgent = request.headers.get("user-agent") ?? "";
  const secret = process.env.REDBARK_WEBHOOK_SECRET!;

  let payload: {
    id?: string;
    object?: string;
    type?: string;
    api_version?: string;
    created?: number;
    data?: { new: RedbarkTransaction[]; updated: RedbarkTransaction[] };
    metadata?: {
      sync_run_id?: string;
      new_count?: number;
      updated_count?: number;
      chunk?: number;
      total_chunks?: number;
    };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    console.error("redbark:webhook JSON parse failed", {
      deliveryId,
      bodyBytes: rawBody.length,
      error: String(e),
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!verifyWebhook(rawBody, signature, timestamp, secret)) {
    console.warn("redbark:webhook signature verification failed", {
      deliveryId,
      hasSignature: Boolean(signature),
      hasTimestamp: Boolean(timestamp),
      bodyBytes: rawBody.length,
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (payload.type !== "transactions.synced") {
    console.log("redbark:webhook ignored (unsupported event type)", {
      deliveryId,
      eventId: payload.id,
      object: payload.object,
      type: payload.type,
      apiVersion: payload.api_version,
      userAgent,
    });
    return NextResponse.json({ status: "ignored", type: payload.type });
  }

  const dataNew = payload.data?.new ?? [];
  const dataUpdated = payload.data?.updated ?? [];
  const meta = payload.metadata ?? {};

  const newSummary = summarizeBatch(dataNew);
  const updatedSummary = summarizeBatch(dataUpdated);

  console.log("redbark:webhook transactions.synced received", {
    deliveryId,
    eventId: payload.id,
    apiVersion: payload.api_version,
    createdUnix: payload.created,
    userAgent,
    syncRunId: meta.sync_run_id,
    chunk: meta.chunk,
    totalChunks: meta.total_chunks,
    metadataNewCount: meta.new_count,
    metadataUpdatedCount: meta.updated_count,
    payloadNewLength: dataNew.length,
    payloadUpdatedLength: dataUpdated.length,
    new: {
      ...newSummary,
      debitTotalAud: centsToAud(newSummary.debitTotalCents),
      creditTotalAud: centsToAud(newSummary.creditTotalCents),
    },
    updated: {
      ...updatedSummary,
      debitTotalAud: centsToAud(updatedSummary.debitTotalCents),
      creditTotalAud: centsToAud(updatedSummary.creditTotalCents),
    },
    newSamples: dataNew.slice(0, 5).map(txnPreview),
    updatedSamples: dataUpdated.slice(0, 3).map(txnPreview),
  });

  const supabase = createServiceClient();

  // Upsert accounts
  const accountMap = new Map<string, string>();
  const allTransactions = [...dataNew, ...dataUpdated];
  const distinctAccountLabels = new Set<string>();
  let accountUpserts = 0;

  for (const txn of allTransactions) {
    const accountLabel = txn.account_name ?? txn.account;
    distinctAccountLabels.add(accountLabel);
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

      const { data: account, error: accErr } = await supabase
        .from("accounts")
        .upsert(row, { onConflict: "redbark_name" })
        .select("id")
        .single();

      if (accErr) {
        console.error("redbark:webhook account upsert failed", {
          deliveryId,
          accountLabel,
          redbarkAccountId: txn.account_id,
          error: accErr.message,
          code: accErr.code,
        });
      } else if (account) {
        accountMap.set(accountLabel, account.id);
        accountUpserts++;
      }
    }
  }

  console.log("redbark:webhook accounts prepared", {
    deliveryId,
    distinctAccountLabels: [...distinctAccountLabels].sort(),
    distinctAccountCount: distinctAccountLabels.size,
    accountUpsertsThisRun: accountUpserts,
    mapSize: accountMap.size,
  });

  // Insert new transactions (ai_status defaults to 'pending')
  let insertedCount = 0;
  let insertErrors = 0;
  for (const txn of dataNew) {
    const label = txn.account_name ?? txn.account;
    const accountId = accountMap.get(label);
    if (!accountId) {
      console.warn("redbark:webhook new txn missing resolved account row", {
        deliveryId,
        redbarkId: txn.id,
        accountLabel: label,
        hasRedbarkAccountId: Boolean(txn.account_id),
      });
    }

    const { error } = await supabase
      .from("transactions")
      .upsert(
        {
          redbark_id: txn.id,
          account_id: accountId,
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
      insertErrors++;
      console.error("redbark:webhook transaction upsert failed", {
        deliveryId,
        redbarkId: txn.id,
        date: txn.transaction_date,
        accountLabel: label,
        error: error.message,
        code: error.code,
        details: error.details,
      });
    } else {
      insertedCount++;
    }
  }

  let updateErrors = 0;
  for (const txn of dataUpdated) {
    const { error } = await supabase
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

    if (error) {
      updateErrors++;
      console.error("redbark:webhook transaction update failed", {
        deliveryId,
        redbarkId: txn.id,
        error: error.message,
        code: error.code,
      });
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log("redbark:webhook transactions.synced complete", {
    deliveryId,
    syncRunId: meta.sync_run_id,
    chunk: meta.chunk != null && meta.total_chunks != null ? `${meta.chunk}/${meta.total_chunks}` : undefined,
    insertedCount,
    insertErrors,
    updatedAttempted: dataUpdated.length,
    updateErrors,
    elapsedMs,
    note: "New rows use ai_status=pending until categorise-pending cron runs.",
  });

  return NextResponse.json({
    status: "ok",
    delivery_id: deliveryId,
    new_count: insertedCount,
    updated_count: dataUpdated.length,
    chunk: `${meta.chunk ?? "?"}/${meta.total_chunks ?? "?"}`,
  });
}
