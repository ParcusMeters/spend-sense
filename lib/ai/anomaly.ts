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

function extractJsonArray(candidate: string): string | null {
  const text = candidate.trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

async function detectAnomaliesHeuristic(
  supabase: ReturnType<typeof createServiceClient>,
  transactionId: string,
  merchant: string | null,
  amountCents: number,
  date: string,
  isRecurring: boolean,
): Promise<AnomalyResult[]> {
  const anomalies: AnomalyResult[] = [];

  // 1. Duplicate detection: same merchant + same amount + same day
  if (merchant) {
    const { data: dupes } = await supabase
      .from("transactions")
      .select("id")
      .eq("merchant", merchant)
      .eq("amount_cents", amountCents)
      .eq("date", date)
      .neq("id", transactionId);

    if (dupes && dupes.length > 0) {
      anomalies.push({
        transaction_id: transactionId,
        type: "duplicate",
        description: `Possible duplicate: same merchant (${merchant}), amount ($${Math.abs(amountCents) / 100}), and date`,
        severity: "high",
      });
    }
  }

  // 2. Unusual amount: compare to average for this merchant
  if (merchant) {
    const { data: history } = await supabase
      .from("transactions")
      .select("amount_cents")
      .eq("merchant", merchant)
      .neq("id", transactionId)
      .order("date", { ascending: false })
      .limit(20);

    if (history && history.length >= 3) {
      const amounts = history.map((t) => Math.abs(t.amount_cents));
      const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const absAmount = Math.abs(amountCents);

      if (absAmount > avg * 2 && absAmount - avg > 2000) {
        anomalies.push({
          transaction_id: transactionId,
          type: "unusual_amount",
          description: `Unusual amount: $${(absAmount / 100).toFixed(2)} vs average $${(avg / 100).toFixed(2)} at ${merchant}`,
          severity: absAmount > avg * 3 ? "high" : "medium",
        });
      }
    }
  }

  // 3. Subscription change: recurring charge with different amount
  if (isRecurring && merchant) {
    const { data: previous } = await supabase
      .from("transactions")
      .select("amount_cents")
      .eq("merchant", merchant)
      .eq("is_recurring", true)
      .neq("id", transactionId)
      .order("date", { ascending: false })
      .limit(1);

    if (previous && previous.length > 0) {
      const prevAmount = previous[0].amount_cents;
      if (prevAmount !== amountCents) {
        anomalies.push({
          transaction_id: transactionId,
          type: "subscription_change",
          description: `Subscription price change at ${merchant}: was $${(Math.abs(prevAmount) / 100).toFixed(2)}, now $${(Math.abs(amountCents) / 100).toFixed(2)}`,
          severity: "medium",
        });
      }
    }
  }

  return anomalies;
}

async function detectAnomaliesAi(
  supabase: ReturnType<typeof createServiceClient>,
  transactionId: string,
  merchant: string | null,
  amountCents: number,
  date: string,
  isRecurring: boolean,
): Promise<AnomalyResult[]> {
  // Pull transaction context (needed for unusual_merchant/unusual_time).
  const { data: txnRow } = await supabase
    .from("transactions")
    .select("id, account_id, description, merchant, amount_cents, date, direction")
    .eq("id", transactionId)
    .single();

  if (!txnRow) return [];

  const currentMerchant = merchant ?? txnRow.merchant ?? null;
  const currentDescription = String(txnRow.description ?? "");
  const absAmount = Math.abs(amountCents);
  const absAmountDollars = (absAmount / 100).toFixed(2);

  // Overseas / international keywords are a noisy signal, but it is a
  // strong "context" indicator for fraud-like anomalies.
  // This intentionally errs on the side of being conservative.
  const overseasLikely =
    /(^|[^a-z])(intl|international|overseas|swift|wire|remittance)([^a-z]|$)/i.test(
      `${currentMerchant ?? ""} ${currentDescription}`,
    ) ||
    /(\btransferwise\b|\brevolut\b|\bwise\b)/i.test(
      `${currentMerchant ?? ""} ${currentDescription}`,
    );

  // Evidence: duplicates
  const { data: dupes } = currentMerchant
    ? await supabase
        .from("transactions")
        .select("id")
        .eq("merchant", currentMerchant)
        .eq("amount_cents", amountCents)
        .eq("date", date)
        .neq("id", transactionId)
    : { data: [] as { id: string }[] };

  const duplicateLikely = Boolean(dupes && dupes.length > 0);

  // Evidence: merchant amount history (last 20)
  let avg = null as number | null;
  let recentAmounts: number[] = [];
  if (currentMerchant) {
    const { data: history } = await supabase
      .from("transactions")
      .select("amount_cents")
      .eq("merchant", currentMerchant)
      .neq("id", transactionId)
      .order("date", { ascending: false })
      .limit(20);

    if (history && history.length > 0) {
      recentAmounts = history.map((t) => Math.abs(t.amount_cents));
      const sum = recentAmounts.reduce((a, b) => a + b, 0);
      avg = sum / recentAmounts.length;
    }
  }

  const unusualAmountLikely =
    avg !== null &&
    recentAmounts.length >= 3 &&
    absAmount > avg * 2 &&
    absAmount - avg > 2000;

  // Evidence: previous recurring amount (last 1 for same merchant)
  let previousRecurringAmountCents: number | null = null;
  if (isRecurring && currentMerchant) {
    const { data: previous } = await supabase
      .from("transactions")
      .select("amount_cents")
      .eq("merchant", currentMerchant)
      .eq("is_recurring", true)
      .neq("id", transactionId)
      .order("date", { ascending: false })
      .limit(1);

    if (previous && previous.length > 0) {
      previousRecurringAmountCents = previous[0].amount_cents;
    }
  }

  const subscriptionChangeLikely =
    previousRecurringAmountCents !== null && previousRecurringAmountCents !== amountCents;

  // Evidence: unusual_merchant (merchant never seen for this account before)
  let unusualMerchantLikely = false;
  if (currentMerchant) {
    const { data: seen } = await supabase
      .from("transactions")
      .select("id")
      .eq("account_id", txnRow.account_id)
      .eq("merchant", currentMerchant)
      .neq("id", transactionId)
      .limit(1);

    // "New merchant" alone is too sensitive; only treat as anomalous when
    // there's also unusual spend size OR overseas context.
    unusualMerchantLikely =
      (!seen || seen.length === 0) && (unusualAmountLikely || overseasLikely);
  }

  // Evidence: unusual_time (unusual day-of-week for this account)
  const dayOfWeek = new Date(date + "T00:00:00Z").getUTCDay(); // 0-6
  const { data: recentForAccount } = await supabase
    .from("transactions")
    .select("date")
    .eq("account_id", txnRow.account_id)
    .gte("date", new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10))
    .order("date", { ascending: false })
    .limit(250);

  const recentDows = (recentForAccount ?? []).map((t) =>
    new Date(String(t.date) + "T00:00:00Z").getUTCDay()
  );
  const dowCount = recentDows.filter((d) => d === dayOfWeek).length;
  const dowTotal = recentDows.length;
  // "Unusual day-of-week" alone is too sensitive; require unusual spend
  // size OR overseas context.
  const unusualTimeLikely =
    dowTotal > 0 ? dowCount / dowTotal < 0.08 : false;
  const unusualTimeStrongLikely =
    unusualTimeLikely && (unusualAmountLikely || overseasLikely);

  const prompt = `You are an anomaly detection assistant for personal finance.
Decide which of the following anomaly types apply to the CURRENT transaction.

CURRENT transaction:
{
  "transaction_id": "${transactionId}",
  "merchant": ${JSON.stringify(currentMerchant)},
  "amount_cents": ${amountCents},
  "amount_dollars": ${absAmountDollars},
  "date": ${JSON.stringify(date)},
  "is_recurring": ${isRecurring}
}

EVIDENCE / signals (may be noisy):
- duplicateLikely: ${duplicateLikely}
- unusualAmountLikely: ${unusualAmountLikely}
- subscriptionChangeLikely: ${subscriptionChangeLikely}
- unusualMerchantLikely: ${unusualMerchantLikely}
- unusualTimeStrongLikely: ${unusualTimeStrongLikely}

Notes:
- If the corresponding Likely flag is false, you should usually return no anomaly of that type.
- If multiple types apply, include multiple objects in the output array.
- Use concise, human-readable explanations.

Return ONLY a JSON array. Each element:
{
  "transaction_id": string,
  "type": one of ["duplicate","unusual_amount","unusual_merchant","unusual_time","subscription_change"],
  "description": string,
  "severity": one of ["low","medium","high"]
}
Return an empty array [] if nothing looks anomalous.`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2000,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((c) => c.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  const text = textBlock?.text ?? "";

  const cleaned = text.trim().replace(/```(?:json)?/g, "").replace(/```/g, "").trim();
  const arrayJson = extractJsonArray(cleaned);
  if (!arrayJson) return [];

  const parsed = JSON.parse(arrayJson) as unknown;
  if (!Array.isArray(parsed)) return [];

  const allowedTypes: AnomalyType[] = [
    "duplicate",
    "unusual_amount",
    "unusual_merchant",
    "unusual_time",
    "subscription_change",
  ];

  const allowedSeverities: AnomalyResult["severity"][] = ["low", "medium", "high"];

  const normalised: AnomalyResult[] = [];
  for (const r of parsed as unknown[]) {
    if (!r || typeof r !== "object") continue;
    const obj = r as Record<string, unknown>;
    const type = String(obj.type ?? "");
    const severity = String(obj.severity ?? "");
    const description = String(obj.description ?? "");
    const txId = String(obj.transaction_id ?? transactionId);

    if (!allowedTypes.includes(type as AnomalyType)) continue;
    if (!allowedSeverities.includes(severity as AnomalyResult["severity"])) continue;
    if (!description) continue;

    // Post-filter to reduce sensitivity:
    // - "new merchant" (unusual_merchant) must be backed by unusual amount
    //   and/or overseas context (we incorporate that into unusualMerchantLikely).
    // - "unusual day-of-week" (unusual_time) must also be backed by the same strong evidence.
    if (type === "unusual_merchant" && !unusualMerchantLikely) continue;
    if (type === "unusual_time" && !unusualTimeStrongLikely) continue;

    normalised.push({
      transaction_id: txId,
      type: type as AnomalyType,
      description,
      severity: severity as AnomalyResult["severity"],
    });
  }

  return normalised;
}

export async function detectAnomalies(
  transactionId: string,
  merchant: string | null,
  amountCents: number,
  date: string,
  isRecurring: boolean,
): Promise<AnomalyResult[]> {
  const supabase = createServiceClient();

  // Keep current deterministic logic as a fallback.
  const fallback = await detectAnomaliesHeuristic(
    supabase,
    transactionId,
    merchant,
    amountCents,
    date,
    isRecurring,
  );

  try {
    // If Anthropic isn't configured, we can't do AI anomalies.
    if (!process.env.ANTHROPIC_API_KEY) return fallback;

    const aiAnomalies = await detectAnomaliesAi(
      supabase,
      transactionId,
      merchant,
      amountCents,
      date,
      isRecurring,
    );

    // If AI returns nothing, use fallback so anomalies still show up.
    // (This prevents “nothing flagged” when AI is unavailable/failed.)
    return aiAnomalies.length > 0 ? aiAnomalies : fallback;
  } catch (error) {
    console.warn("AI anomaly detection failed; using heuristics", {
      transactionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}
