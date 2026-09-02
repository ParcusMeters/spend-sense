import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const CATEGORIES = [
  "Salary",
  "Groceries",
  "Eating out",
  "Drinks & nightlife",
  "Transport",
  "Rent",
  "Bills & utilities",
  "Subscriptions",
  "Entertainment",
  "Health",
  "Shopping",
  "Travel",
  "Bank fees",
  "Transfers",
  "Reimbursements",
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
- any transaction with transaction details including "Revolut" should be set to category "Travel"

Salary vs Transfers (important):
- "Salary" is ONLY for income paid by an employer or external party (wages, salary, freelance payments, government benefits). The description usually contains a company/business name and keywords like "payroll", "salary", "wages", or a recognisable employer name.
- "Transfers" is for money moving between the user's OWN accounts (e.g. savings ↔ everyday, Revolut top-ups, moving money between banks). Look for generic descriptions like "Transfer", "Direct Credit", account numbers, or the user's own name.
- When a credit transaction is ambiguous and could be either, prefer "Transfers" over "Salary". Only use "Salary" when you are reasonably confident it is external income.

Rent and bills (important):
- "Rent" is rent paid out to a landlord, real estate agent or housemate, including when it is sent as a bank transfer or PayID payment to that person. Where the payee is external, "Rent" beats "Transfers" even though the transaction is a transfer.
- BUT a move between the user's own accounts stays "Transfers" even when the memo says rent. Descriptions like "Transfer to xx4324 CommBank app, Rent" are the user setting money aside for rent, not paying it — these are account numbers, not payees.
- "Bills & utilities" is electricity, gas, water, internet, mobile phone and council rates. Phone and internet plans belong here, not in "Subscriptions" — keep "Subscriptions" for software, streaming and memberships.
- The bank category RENT_AND_UTILITIES is a strong hint for one of these two; read the description to decide which.

Reimbursements:
- "Reimbursements" is for credit transactions where someone (a friend, colleague, or individual) is paying the user back for a shared expense. Look for PayID payments from individual names, bank transfers with personal names, or small-to-medium credits that look like splitting bills, rent, travel, or group bookings.
- Do NOT use "Reimbursements" for refunds from businesses — those should be categorised the same as the original purchase (e.g. a refund from a shop is "Shopping").

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
      model: "claude-sonnet-5",
      max_tokens: 8192,
      thinking: { type: "disabled" },
      messages: [
        {
          role: "user",
          content: plainPrompt,
        },
      ],
    });
  } catch (error) {
    const e = error as {
      message?: string;
      status?: number;
      code?: string;
      response?: { status?: number; data?: { code?: string } };
    };
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
    const results: unknown[] = Array.isArray(parsed) ? parsed : [];

    // Coerce primitive types because models sometimes return numbers/booleans
    // as strings (e.g. "0.83", "true"). If coercion fails, drop the item.
    const normalised: CategorisationResult[] = [];
    for (const r of results) {
      if (!r || typeof r !== "object") continue;
      const obj = r as Record<string, unknown>;

      const redbark_id = String(obj.redbark_id ?? "").trim();
      const category = String(obj.category ?? "").trim();
      const merchant_clean = String(obj.merchant_clean ?? "").trim();

      const confidenceRaw = obj.confidence;
      const confidenceNum =
        typeof confidenceRaw === "number" ? confidenceRaw : Number(confidenceRaw);

      const isRecurringRaw = obj.is_recurring;
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
