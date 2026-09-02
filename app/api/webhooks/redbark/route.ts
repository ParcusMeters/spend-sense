import { NextRequest, NextResponse, after } from "next/server";
import { verifyWebhook } from "@/lib/redbark/webhook";
import type { RedbarkTransaction } from "@/lib/redbark/types";
import { createServiceClient } from "@/lib/supabase/server";
import { processPendingCategorisation } from "@/lib/categorise/process-pending";

type AccountRow = {
  id: string;
  redbark_name: string;
  redbark_account_id: string | null;
  user_id: string;
};

type AccountRef = { id: string; userId: string; redbarkAccountId: string | null };

type TransactionsSyncedPayload = {
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

type PersistResult = {
  insertedCount: number;
  insertErrors: number;
  insertSkipped: number;
  updatedAttempted: number;
  updateErrors: number;
  elapsedMs: number;
};

async function persistTransactionsSyncedPayload(
  payload: TransactionsSyncedPayload,
  deliveryId: string,
  userAgent: string
): Promise<PersistResult> {
  const startedAt = Date.now();
  const dataNew = payload.data?.new ?? [];
  const dataUpdated = payload.data?.updated ?? [];
  const meta = payload.metadata ?? {};

  const newSummary = summarizeBatch(dataNew);
  const updatedSummary = summarizeBatch(dataUpdated);

  console.log("redbark:webhook transactions.synced received (async)", {
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

  const allTransactions = [...dataNew, ...dataUpdated];
  const distinctAccountLabels = new Set<string>();

  // accounts and transactions are both owned rows: user_id is NOT NULL, and accounts is
  // unique on (redbark_name, user_id). Existing account rows are the source of truth for
  // the owner, so load them once and resolve every txn against them.
  const { data: existingAccounts, error: accountsErr } = await supabase
    .from("accounts")
    .select("id, redbark_name, redbark_account_id, user_id");

  if (accountsErr) {
    console.error("redbark:webhook failed to load accounts", {
      deliveryId,
      error: accountsErr.message,
      code: accountsErr.code,
    });
    throw new Error(`failed to load accounts: ${accountsErr.message}`);
  }

  const byRedbarkAccountId = new Map<string, AccountRef>();
  const byName = new Map<string, AccountRef>();
  const knownOwnerIds = new Set<string>();

  for (const a of (existingAccounts ?? []) as AccountRow[]) {
    const ref: AccountRef = {
      id: a.id,
      userId: a.user_id,
      redbarkAccountId: a.redbark_account_id,
    };
    if (a.redbark_account_id) byRedbarkAccountId.set(a.redbark_account_id, ref);
    byName.set(a.redbark_name, ref);
    knownOwnerIds.add(a.user_id);
  }

  const ownerUserId =
    process.env.REDBARK_OWNER_USER_ID?.trim() ||
    (knownOwnerIds.size === 1 ? [...knownOwnerIds][0] : null);

  const accountMap = new Map<string, AccountRef>();
  let accountUpserts = 0;

  for (const txn of allTransactions) {
    const accountLabel = txn.account_name ?? txn.account;
    distinctAccountLabels.add(accountLabel);
    if (accountMap.has(accountLabel)) continue;

    const known =
      (txn.account_id ? byRedbarkAccountId.get(txn.account_id) : undefined) ??
      byName.get(accountLabel);

    if (known) {
      // Redbark account names are not unique (two live accounts can share a label), but
      // accounts is unique on (redbark_name, user_id) — so a name-only match may fold a
      // second Redbark account into an existing row. Surface it rather than hide it.
      if (txn.account_id && known.redbarkAccountId && known.redbarkAccountId !== txn.account_id) {
        console.warn("redbark:webhook account matched by name, not by redbark id", {
          deliveryId,
          accountLabel,
          payloadRedbarkAccountId: txn.account_id,
          matchedRedbarkAccountId: known.redbarkAccountId,
        });
      }
      accountMap.set(accountLabel, known);
      continue;
    }

    if (!ownerUserId) {
      console.error("redbark:webhook cannot create account without an owner user_id", {
        deliveryId,
        accountLabel,
        redbarkAccountId: txn.account_id ?? null,
        knownOwnerCount: knownOwnerIds.size,
        hint: "set REDBARK_OWNER_USER_ID when more than one user owns accounts",
      });
      continue;
    }

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
      user_id: ownerUserId,
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
      .upsert(row, { onConflict: "redbark_name,user_id" })
      .select("id, user_id")
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
      const ref: AccountRef = {
        id: account.id,
        userId: account.user_id,
        redbarkAccountId: txn.account_id ?? null,
      };
      accountMap.set(accountLabel, ref);
      byName.set(accountLabel, ref);
      if (txn.account_id) byRedbarkAccountId.set(txn.account_id, ref);
      accountUpserts++;
    }
  }

  console.log("redbark:webhook accounts prepared", {
    deliveryId,
    distinctAccountLabels: [...distinctAccountLabels].sort(),
    distinctAccountCount: distinctAccountLabels.size,
    existingAccountRows: existingAccounts?.length ?? 0,
    accountUpsertsThisRun: accountUpserts,
    mapSize: accountMap.size,
    ownerUserIdResolved: Boolean(ownerUserId),
  });

  let insertedCount = 0;
  let insertErrors = 0;
  let insertSkipped = 0;

  // Build every row first, then write in batches. This runs inside the request, so
  // one round trip per batch (rather than per transaction) is what keeps a large
  // delivery inside the webhook timeout.
  const rowsToInsert: Record<string, unknown>[] = [];
  for (const txn of dataNew) {
    const label = txn.account_name ?? txn.account;
    const account = accountMap.get(label);
    if (!account) {
      console.warn("redbark:webhook new txn missing resolved account row", {
        deliveryId,
        redbarkId: txn.id,
        accountLabel: label,
        hasRedbarkAccountId: Boolean(txn.account_id),
      });
    }

    // transactions.user_id is NOT NULL; without an owner the row cannot be written at all.
    const userId = account?.userId ?? ownerUserId;
    if (!userId) {
      insertSkipped++;
      console.error("redbark:webhook new txn skipped (no owner user_id)", {
        deliveryId,
        redbarkId: txn.id,
        accountLabel: label,
      });
      continue;
    }

    rowsToInsert.push({
      redbark_id: txn.id,
      user_id: userId,
      account_id: account?.id ?? null,
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
    });
  }

  const INSERT_BATCH = 100;
  for (let i = 0; i < rowsToInsert.length; i += INSERT_BATCH) {
    const batch = rowsToInsert.slice(i, i + INSERT_BATCH);
    const { error } = await supabase
      .from("transactions")
      .upsert(batch, { onConflict: "redbark_id" });

    if (error) {
      insertErrors += batch.length;
      console.error("redbark:webhook transaction batch upsert failed", {
        deliveryId,
        batchStart: i,
        batchSize: batch.length,
        firstRedbarkId: batch[0]?.redbark_id,
        error: error.message,
        code: error.code,
        details: error.details,
      });
    } else {
      insertedCount += batch.length;
    }
  }

  // Updates stay per-row (each targets a different redbark_id) but run with bounded
  // concurrency so a large batch cannot blow the request timeout.
  let updateErrors = 0;
  const UPDATE_CONCURRENCY = 10;
  for (let i = 0; i < dataUpdated.length; i += UPDATE_CONCURRENCY) {
    const batch = dataUpdated.slice(i, i + UPDATE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (txn) => {
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
            ai_status: "pending",
            updated_at: new Date().toISOString(),
          })
          .eq("redbark_id", txn.id);
        return { txn, error };
      })
    );

    for (const { txn, error } of results) {
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
  }

  const elapsedMs = Date.now() - startedAt;

  console.log("redbark:webhook transactions.synced persisted", {
    deliveryId,
    syncRunId: meta.sync_run_id,
    chunk: meta.chunk != null && meta.total_chunks != null ? `${meta.chunk}/${meta.total_chunks}` : undefined,
    insertedCount,
    insertErrors,
    insertSkipped,
    updatedAttempted: dataUpdated.length,
    updateErrors,
    elapsedMs,
    note: "Rows are saved with ai_status=pending; categorisation runs after the response.",
  });

  return {
    insertedCount,
    insertErrors,
    insertSkipped,
    updatedAttempted: dataUpdated.length,
    updateErrors,
    elapsedMs,
  };
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-redbark-signature") ?? "";
  const timestamp = request.headers.get("x-redbark-timestamp") ?? "";
  const deliveryId = request.headers.get("x-redbark-delivery-id") ?? "";
  const userAgent = request.headers.get("user-agent") ?? "";
  const secret = process.env.REDBARK_WEBHOOK_SECRET!;

  let payload: TransactionsSyncedPayload;
  try {
    payload = JSON.parse(rawBody) as TransactionsSyncedPayload;
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

  // Persist before responding. Redbark webhook destinations carry the only copy of
  // these payloads — there is no replay: `resync` re-reads the window but re-sends
  // nothing already delivered, and event redelivery carries counts, not rows. So a
  // 2xx returned before the write turns any downstream failure into permanent data
  // loss. Answering non-2xx is the only way to tell Redbark the delivery failed.
  let result: PersistResult;
  try {
    result = await persistTransactionsSyncedPayload(payload, deliveryId, userAgent);
  } catch (err) {
    console.error("redbark:webhook processing failed", {
      deliveryId,
      newCount: dataNew.length,
      updatedCount: dataUpdated.length,
      chunk: meta.chunk,
      totalChunks: meta.total_chunks,
      error: String(err),
    });
    return NextResponse.json(
      { error: "processing_failed", delivery_id: deliveryId },
      { status: 500 }
    );
  }

  const lostRows = result.insertErrors + result.insertSkipped + result.updateErrors;
  if (lostRows > 0) {
    console.error("redbark:webhook rejecting delivery, rows not persisted", {
      deliveryId,
      insertErrors: result.insertErrors,
      insertSkipped: result.insertSkipped,
      updateErrors: result.updateErrors,
      insertedCount: result.insertedCount,
      chunk: meta.chunk,
      totalChunks: meta.total_chunks,
    });
    return NextResponse.json(
      {
        error: "partial_failure",
        delivery_id: deliveryId,
        persisted: result.insertedCount,
        failed: lostRows,
      },
      { status: 500 }
    );
  }

  // Categorisation is enrichment, not durability: rows are already saved with
  // ai_status='pending' and the categorise cron picks up anything missed here.
  if (result.insertedCount > 0 || result.updatedAttempted > 0) {
    after(async () => {
      try {
        const categoriseResult = await processPendingCategorisation();
        console.log("redbark:webhook auto-categorise complete", {
          deliveryId,
          categoriseResult,
        });
      } catch (error) {
        console.error("redbark:webhook auto-categorise failed", {
          deliveryId,
          error: String(error),
        });
      }
    });
  }

  console.log("redbark:webhook delivery persisted", {
    deliveryId,
    newCount: dataNew.length,
    updatedCount: dataUpdated.length,
    insertedCount: result.insertedCount,
    elapsedMs: result.elapsedMs,
    chunk: meta.chunk,
    totalChunks: meta.total_chunks,
  });

  return NextResponse.json({
    status: "ok",
    delivery_id: deliveryId,
    new_count: dataNew.length,
    updated_count: dataUpdated.length,
    persisted: result.insertedCount,
    chunk: `${meta.chunk ?? "?"}/${meta.total_chunks ?? "?"}`,
  });
}
