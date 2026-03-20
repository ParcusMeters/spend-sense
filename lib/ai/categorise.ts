import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const CATEGORIES = [
  "Salary",
  "Groceries",
  "Eating out",
  "Drinks & nightlife",
  "Transport",
  "Subscriptions",
  "Entertainment",
  "Health",
  "Shopping",
  "Travel",
  "Bank fees",
  "Transfers",
  "Investing",
  "Other",
] as const;

interface CategorisationResult {
  redbark_id: string;
  category: string;
  confidence: number;
  is_recurring: boolean;
  merchant_clean: string;
}

export async function categoriseTransactions(
  transactions: {
    redbark_id: string;
    description: string;
    amount_cents: number;
    direction: string;
    merchant: string | null;
    redbark_category: string | null;
  }[],
  ctx?: { aiRunId?: string; batchIndex?: number }
): Promise<CategorisationResult[]> {
  if (transactions.length === 0) return [];
  const startedAt = Date.now();
  console.log("AI categorise start", {
    aiRunId: ctx?.aiRunId,
    batchIndex: ctx?.batchIndex,
    count: transactions.length,
    sampleIds: transactions.map((t) => t.redbark_id).slice(0, 3),
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });

  const txnList = transactions
    .map(
      (t, i) =>
        `${i + 1}. ID: ${t.redbark_id} | "${t.description}" | ${t.direction} ${Math.abs(t.amount_cents) / 100} AUD | Merchant: ${t.merchant ?? "unknown"} | Bank category: ${t.redbark_category ?? "none"}`
    )
    .join("\n");

  const plainPrompt = `Categorise these Australian bank transactions.

Return ONLY a single JSON array. The first character MUST be '[' and the last character MUST be ']'.
No markdown, no code fences, no explanation text.

For each transaction, return an object with EXACT keys:
{"redbark_id","category","confidence","is_recurring","merchant_clean"}

Rules:
- category must be one of: ${CATEGORIES.join(", ")}
- confidence is a number from 0 to 1
- is_recurring is true or false
- merchant_clean must be a single line string (no newlines), max 40 chars, and must NOT include quotation marks

Recurring detection rule (important):
- Set is_recurring = true ONLY when this looks like a subscription you have signed up for.
- It should show a regular billing cadence consistent with either:
  - weekly-ish (about every 7 +/- 2 days), or
  - monthly-ish (about every 30 +/- 5 days),
  AND it should look like a service/plan (e.g. streaming, utilities, memberships).
- If it looks like general repeated spending (groceries, dining, transport) or it is irregular/uncertain, set is_recurring = false.

Transactions:
${txnList}`;

  let message;
  try {
    message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: plainPrompt,
        },
      ],
    });
  } catch (error) {
    const e = error as any;
    console.error("AI categorise request failed", {
      count: transactions.length,
      aiRunId: ctx?.aiRunId,
      batchIndex: ctx?.batchIndex,
      sampleIds: transactions.map((t) => t.redbark_id).slice(0, 3),
      message: e?.message,
      status: e?.status ?? e?.response?.status,
      code: e?.code ?? e?.response?.data?.code,
      responseData: e?.response?.data ?? null,
    });
    return [];
  }

  console.log("AI categorise response received", {
    elapsedMs: Date.now() - startedAt,
    contentBlocks: message.content.length,
    stopReason: message.stop_reason,
  });

  const textBlock = message.content.find((c) => c.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  const text = textBlock?.text ?? "";

  const cleaned = text
    .trim()
    .replace(/```(?:json)?/g, "")
    .replace(/```/g, "")
    .trim();

  try {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    const jsonCandidate =
      start !== -1 && end !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;

    const parsed = JSON.parse(jsonCandidate) as unknown;
    const results = Array.isArray(parsed) ? parsed : [];
    if (!Array.isArray(results)) return [];

    // Coerce primitive types because models sometimes return numbers/booleans
    // as strings (e.g. "0.83", "true"). If coercion fails, drop the item.
    const normalised: CategorisationResult[] = [];
    for (const r of results as any[]) {
      const redbark_id = String((r as any).redbark_id ?? "").trim();
      const category = String((r as any).category ?? "").trim();
      const merchant_clean = String((r as any).merchant_clean ?? "").trim();

      const confidenceRaw = (r as any).confidence;
      const confidenceNum = typeof confidenceRaw === "number"
        ? confidenceRaw
        : Number(confidenceRaw);

      const isRecurringRaw = (r as any).is_recurring;
      const is_recurring =
        typeof isRecurringRaw === "boolean"
          ? isRecurringRaw
          : typeof isRecurringRaw === "string"
            ? ["true", "t", "1", "yes"].includes(isRecurringRaw.toLowerCase())
            : false;

      if (!redbark_id || !category || !merchant_clean) continue;
      if (!Number.isFinite(confidenceNum)) continue;

      normalised.push({
        redbark_id,
        category,
        confidence: Math.max(0, Math.min(1, confidenceNum)),
        is_recurring,
        merchant_clean,
      });
    }

    console.log("AI categorise parsed", {
      requested: transactions.length,
      parsed: normalised.length,
      elapsedMs: Date.now() - startedAt,
    });

    return normalised;
  } catch (err) {
    console.warn("categoriseTransactions: JSON parse failed", {
      ids: transactions.map((t) => t.redbark_id).slice(0, 3),
      aiRunId: ctx?.aiRunId,
      batchIndex: ctx?.batchIndex,
      textLength: text.length,
      error: String(err),
      cleanedPreview: cleaned.slice(0, 300),
    });
    return [];
  }
}
