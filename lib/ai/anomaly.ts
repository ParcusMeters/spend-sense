import { createServiceClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

type AnomalyType =
  | "duplicate"
  | "unusual_amount"
  | "unusual_merchant"
  | "unusual_time"
  | "subscription_change";

interface AnomalyResult {
  transaction_id: string;
  type: AnomalyType;
  description: string;
  severity: "low" | "medium" | "high";
}

export type AnomalyCandidate = {
  transactionId: string;
  merchant: string | null;
  amountCents: number;
  date: string;
  isRecurring: boolean;
};

/**
 * Deterministic signals for one transaction, gathered from the database.
 *
 * Whether a transaction is anomalous is decided entirely by these flags — the
 * model only phrases the finding, and its output is post-filtered by the same
 * flags. So a transaction with no signal has nothing to say and is never sent.
 */
type AnomalyEvidence = AnomalyCandidate & {
  duplicateLikely: boolean;
  unusualAmountLikely: boolean;
  subscriptionChangeLikely: boolean;
  unusualMerchantLikely: boolean;
  unusualTimeStrongLikely: boolean;
  averageAmountCents: number | null;
  previousRecurringAmountCents: number | null;
};

const ALLOWED_TYPES: AnomalyType[] = [
  "duplicate",
  "unusual_amount",
  "unusual_merchant",
  "unusual_time",
  "subscription_change",
];

const ALLOWED_SEVERITIES: AnomalyResult["severity"][] = ["low", "medium", "high"];

/** How many transactions have their evidence gathered at once. */
const EVIDENCE_CONCURRENCY = 10;

function extractJsonArray(candidate: string): string | null {
  const text = candidate.trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function hasAnySignal(e: AnomalyEvidence): boolean {
  return (
    e.duplicateLikely ||
    e.unusualAmountLikely ||
    e.subscriptionChangeLikely ||
    e.unusualMerchantLikely ||
    e.unusualTimeStrongLikely
  );
}

async function gatherEvidence(
  supabase: ReturnType<typeof createServiceClient>,
  candidate: AnomalyCandidate
): Promise<AnomalyEvidence | null> {
  const { transactionId, amountCents, date, isRecurring } = candidate;

  const { data: txnRow } = await supabase
    .from("transactions")
    .select("id, account_id, description, merchant, amount_cents, date, direction")
    .eq("id", transactionId)
    .single();

  if (!txnRow) return null;

  const merchant = candidate.merchant ?? txnRow.merchant ?? null;
  const description = String(txnRow.description ?? "");
  const absAmount = Math.abs(amountCents);

  // Overseas context is noisy on its own, but a useful corroborating signal.
  const overseasLikely =
    /(^|[^a-z])(intl|international|overseas|swift|wire|remittance)([^a-z]|$)/i.test(
      `${merchant ?? ""} ${description}`
    ) || /(\btransferwise\b|\brevolut\b|\bwise\b)/i.test(`${merchant ?? ""} ${description}`);

  const [dupeRes, historyRes, previousRes, seenRes, recentRes] = await Promise.all([
    merchant
      ? supabase
          .from("transactions")
          .select("id")
          .eq("merchant", merchant)
          .eq("amount_cents", amountCents)
          .eq("date", date)
          .neq("id", transactionId)
      : Promise.resolve({ data: [] as { id: string }[] }),
    merchant
      ? supabase
          .from("transactions")
          .select("amount_cents")
          .eq("merchant", merchant)
          .neq("id", transactionId)
          .order("date", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as { amount_cents: number }[] }),
    isRecurring && merchant
      ? supabase
          .from("transactions")
          .select("amount_cents")
          .eq("merchant", merchant)
          .eq("is_recurring", true)
          .neq("id", transactionId)
          .order("date", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [] as { amount_cents: number }[] }),
    merchant
      ? supabase
          .from("transactions")
          .select("id")
          .eq("account_id", txnRow.account_id)
          .eq("merchant", merchant)
          .neq("id", transactionId)
          .limit(1)
      : Promise.resolve({ data: [] as { id: string }[] }),
    supabase
      .from("transactions")
      .select("date")
      .eq("account_id", txnRow.account_id)
      .gte("date", new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10))
      .order("date", { ascending: false })
      .limit(250),
  ]);

  const duplicateLikely = Boolean(dupeRes.data && dupeRes.data.length > 0);

  const recentAmounts = (historyRes.data ?? []).map((t) => Math.abs(t.amount_cents));
  const averageAmountCents =
    recentAmounts.length > 0
      ? recentAmounts.reduce((a, b) => a + b, 0) / recentAmounts.length
      : null;

  const unusualAmountLikely =
    averageAmountCents !== null &&
    recentAmounts.length >= 3 &&
    absAmount > averageAmountCents * 2 &&
    absAmount - averageAmountCents > 2000;

  const previousRecurringAmountCents =
    previousRes.data && previousRes.data.length > 0 ? previousRes.data[0].amount_cents : null;

  const subscriptionChangeLikely =
    previousRecurringAmountCents !== null && previousRecurringAmountCents !== amountCents;

  // A merchant being new is far too sensitive alone; require corroboration.
  const unusualMerchantLikely = merchant
    ? (!seenRes.data || seenRes.data.length === 0) && (unusualAmountLikely || overseasLikely)
    : false;

  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
  const recentDows = (recentRes.data ?? []).map((t) =>
    new Date(`${String(t.date)}T00:00:00Z`).getUTCDay()
  );
  const dowTotal = recentDows.length;
  const dowCount = recentDows.filter((d) => d === dayOfWeek).length;
  const unusualTimeLikely = dowTotal > 0 ? dowCount / dowTotal < 0.08 : false;
  const unusualTimeStrongLikely =
    unusualTimeLikely && (unusualAmountLikely || overseasLikely);

  return {
    transactionId,
    merchant,
    amountCents,
    date,
    isRecurring,
    duplicateLikely,
    unusualAmountLikely,
    subscriptionChangeLikely,
    unusualMerchantLikely,
    unusualTimeStrongLikely,
    averageAmountCents,
    previousRecurringAmountCents,
  };
}

/** Descriptions derived straight from the evidence, with no model involved. */
function heuristicFromEvidence(e: AnomalyEvidence): AnomalyResult[] {
  const anomalies: AnomalyResult[] = [];
  const absAmount = Math.abs(e.amountCents);

  if (e.duplicateLikely && e.merchant) {
    anomalies.push({
      transaction_id: e.transactionId,
      type: "duplicate",
      description: `Possible duplicate: same merchant (${e.merchant}), amount ($${absAmount / 100}), and date`,
      severity: "high",
    });
  }

  if (e.unusualAmountLikely && e.merchant && e.averageAmountCents !== null) {
    anomalies.push({
      transaction_id: e.transactionId,
      type: "unusual_amount",
      description: `Unusual amount: $${(absAmount / 100).toFixed(2)} vs average $${(e.averageAmountCents / 100).toFixed(2)} at ${e.merchant}`,
      severity: absAmount > e.averageAmountCents * 3 ? "high" : "medium",
    });
  }

  if (e.subscriptionChangeLikely && e.merchant && e.previousRecurringAmountCents !== null) {
    anomalies.push({
      transaction_id: e.transactionId,
      type: "subscription_change",
      description: `Subscription price change at ${e.merchant}: was $${(Math.abs(e.previousRecurringAmountCents) / 100).toFixed(2)}, now $${(absAmount / 100).toFixed(2)}`,
      severity: "medium",
    });
  }

  return anomalies;
}

async function describeWithAi(flagged: AnomalyEvidence[]): Promise<Map<string, AnomalyResult[]>> {
  const byId = new Map<string, AnomalyResult[]>();

  const payload = flagged.map((e) => ({
    transaction_id: e.transactionId,
    merchant: e.merchant,
    amount_cents: e.amountCents,
    amount_dollars: (Math.abs(e.amountCents) / 100).toFixed(2),
    date: e.date,
    is_recurring: e.isRecurring,
    signals: {
      duplicateLikely: e.duplicateLikely,
      unusualAmountLikely: e.unusualAmountLikely,
      subscriptionChangeLikely: e.subscriptionChangeLikely,
      unusualMerchantLikely: e.unusualMerchantLikely,
      unusualTimeStrongLikely: e.unusualTimeStrongLikely,
    },
  }));

  const prompt = `You are an anomaly detection assistant for personal finance.
For each transaction below, describe the anomalies its signals support.

Only report an anomaly type when its corresponding signal is true:
- duplicateLikely -> "duplicate"
- unusualAmountLikely -> "unusual_amount"
- subscriptionChangeLikely -> "subscription_change"
- unusualMerchantLikely -> "unusual_merchant"
- unusualTimeStrongLikely -> "unusual_time"

A transaction may have several. Use concise, human-readable explanations.

Transactions:
${JSON.stringify(payload, null, 2)}

Return ONLY a JSON array covering every anomaly across all transactions. Each element:
{
  "transaction_id": string,
  "type": one of ["duplicate","unusual_amount","unusual_merchant","unusual_time","subscription_change"],
  "description": string,
  "severity": one of ["low","medium","high"]
}
Return [] if nothing is worth reporting.`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4000,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((c) => c.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  const cleaned = (textBlock?.text ?? "")
    .trim()
    .replace(/```(?:json)?/g, "")
    .replace(/```/g, "")
    .trim();

  const arrayJson = extractJsonArray(cleaned);
  if (!arrayJson) return byId;

  const parsed = JSON.parse(arrayJson) as unknown;
  if (!Array.isArray(parsed)) return byId;

  const evidenceById = new Map(flagged.map((e) => [e.transactionId, e]));

  for (const raw of parsed as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;

    const transactionId = String(obj.transaction_id ?? "");
    const type = String(obj.type ?? "");
    const severity = String(obj.severity ?? "");
    const description = String(obj.description ?? "");

    const evidence = evidenceById.get(transactionId);
    if (!evidence) continue;
    if (!ALLOWED_TYPES.includes(type as AnomalyType)) continue;
    if (!ALLOWED_SEVERITIES.includes(severity as AnomalyResult["severity"])) continue;
    if (!description) continue;

    // The signals, not the model, decide. Anything unsupported is dropped.
    if (type === "duplicate" && !evidence.duplicateLikely) continue;
    if (type === "unusual_amount" && !evidence.unusualAmountLikely) continue;
    if (type === "subscription_change" && !evidence.subscriptionChangeLikely) continue;
    if (type === "unusual_merchant" && !evidence.unusualMerchantLikely) continue;
    if (type === "unusual_time" && !evidence.unusualTimeStrongLikely) continue;

    const list = byId.get(transactionId) ?? [];
    list.push({
      transaction_id: transactionId,
      type: type as AnomalyType,
      description,
      severity: severity as AnomalyResult["severity"],
    });
    byId.set(transactionId, list);
  }

  return byId;
}

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
 * Anomalies for a whole batch, keyed by transaction id.
 *
 * Costs at most one model call for the entire batch, and none at all when no
 * transaction shows a signal — which is the common case. Previously this was one
 * call per transaction regardless, the bulk of them asking the model to find
 * anomalies in a transaction with no supporting evidence.
 */
export async function detectAnomaliesForBatch(
  candidates: AnomalyCandidate[]
): Promise<Map<string, AnomalyResult[]>> {
  const byId = new Map<string, AnomalyResult[]>();
  if (candidates.length === 0) return byId;

  const supabase = createServiceClient();

  const gathered = await mapWithConcurrency(candidates, EVIDENCE_CONCURRENCY, (candidate) =>
    gatherEvidence(supabase, candidate).catch((error) => {
      console.warn("anomaly evidence failed", {
        transactionId: candidate.transactionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    })
  );

  const evidence = gathered.filter((e): e is AnomalyEvidence => e !== null);
  const flagged = evidence.filter(hasAnySignal);

  console.log("anomaly batch", {
    candidates: candidates.length,
    withSignal: flagged.length,
    // One call for the batch, or none at all — previously one per transaction.
    modelCalls: flagged.length > 0 ? 1 : 0,
  });

  // Heuristic descriptions are the baseline and the fallback.
  for (const e of flagged) {
    byId.set(e.transactionId, heuristicFromEvidence(e));
  }

  if (flagged.length === 0) return byId;

  try {
    if (!process.env.ANTHROPIC_API_KEY) return byId;

    const described = await describeWithAi(flagged);
    for (const [transactionId, anomalies] of described) {
      // Keep the heuristic wording if the model returned nothing for this one.
      if (anomalies.length > 0) byId.set(transactionId, anomalies);
    }
  } catch (error) {
    console.warn("AI anomaly description failed; using heuristics", {
      count: flagged.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return byId;
}

/** Single-transaction convenience wrapper around {@link detectAnomaliesForBatch}. */
export async function detectAnomalies(
  transactionId: string,
  merchant: string | null,
  amountCents: number,
  date: string,
  isRecurring: boolean
): Promise<AnomalyResult[]> {
  const byId = await detectAnomaliesForBatch([
    { transactionId, merchant, amountCents, date, isRecurring },
  ]);
  return byId.get(transactionId) ?? [];
}
