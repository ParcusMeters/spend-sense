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

  const structuredPrompt = `Categorise these Australian bank transactions.

For each transaction, you MUST return:
- category: one of the categories provided
- confidence: number between 0 and 1
- is_recurring: true/false
- merchant_clean: cleaned merchant name string (can be same as input merchant)

Categories: ${CATEGORIES.join(", ")}

Transactions:
${txnList}

Return ONLY valid JSON. No markdown, no explanations.
Use this exact shape:
{"results":[{"redbark_id":"...","category":"...","confidence":0.95,"is_recurring":false,"merchant_clean":"..."}]}`;

  const plainPrompt = `Categorise these Australian bank transactions.

For each transaction, you MUST return:
- category: one of the categories provided
- confidence: number between 0 and 1
- is_recurring: true/false
- merchant_clean: cleaned merchant name string (can be same as input merchant)

Categories: ${CATEGORIES.join(", ")}

Transactions:
${txnList}

Return ONLY valid JSON array. No markdown, no explanations.
[{"redbark_id":"...","category":"...","confidence":0.95,"is_recurring":false,"merchant_clean":"..."}]`;

  let message;
  try {
    // First attempt: structured outputs.
    message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: structuredPrompt,
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              results: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    redbark_id: { type: "string" },
                    category: { type: "string" },
                    confidence: { type: "number" },
                    is_recurring: { type: "boolean" },
                    merchant_clean: { type: "string" },
                  },
                  required: [
                    "redbark_id",
                    "category",
                    "confidence",
                    "is_recurring",
                    "merchant_clean",
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ["results"],
            additionalProperties: false,
          },
        },
      },
    });
  } catch (error) {
    const e = error as any;
    console.warn("AI categorise structured output failed; retrying plain JSON", {
      count: transactions.length,
      aiRunId: ctx?.aiRunId,
      batchIndex: ctx?.batchIndex,
      sampleIds: transactions.map((t) => t.redbark_id).slice(0, 3),
      message: e?.message,
      status: e?.status ?? e?.response?.status,
      code: e?.code ?? e?.response?.data?.code,
      responseData: e?.response?.data ?? null,
    });

    try {
      message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: plainPrompt,
          },
        ],
      });
    } catch (error2) {
      const e2 = error2 as any;
      console.error("AI categorise request failed (plain retry)", {
        count: transactions.length,
        aiRunId: ctx?.aiRunId,
        batchIndex: ctx?.batchIndex,
        sampleIds: transactions.map((t) => t.redbark_id).slice(0, 3),
        message: e2?.message,
        status: e2?.status ?? e2?.response?.status,
        code: e2?.code ?? e2?.response?.data?.code,
        responseData: e2?.response?.data ?? null,
      });
      return [];
    }
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

  // Structured outputs should already produce strict JSON, but we still
  // harden parsing against accidental markdown/code fences.
  const cleaned = text
    .trim()
    .replace(/```(?:json)?/g, "")
    .replace(/```/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as
      | CategorisationResult[]
      | { results: CategorisationResult[] };

    const results = Array.isArray(parsed) ? parsed : parsed.results;
    if (!Array.isArray(results)) return [];

    // Coerce primitive types because models sometimes return numbers/booleans
    // as strings (e.g. "0.83", "true"). If coercion fails, drop the item.
    const normalised: CategorisationResult[] = [];
    for (const r of results) {
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
