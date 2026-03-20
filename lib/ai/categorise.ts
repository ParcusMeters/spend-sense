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
  }[]
): Promise<CategorisationResult[]> {
  if (transactions.length === 0) return [];
  const startedAt = Date.now();
  console.log("AI categorise start", {
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

  let message;
  try {
    // Use structured outputs (JSON schema) to avoid "almost JSON" responses.
    // We wrap the results in an object `{ results: [...] }` for schema stability,
    // then we return just the array to the rest of the app.
    message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Categorise these Australian bank transactions.

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
{"results":[{"redbark_id":"...","category":"...","confidence":0.95,"is_recurring":false,"merchant_clean":"..."}]}`,
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
    console.error("AI categorise request failed", {
      count: transactions.length,
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

    // Basic shape validation + confidence bounds
    const normalised = results
      .filter(
        (r) =>
          typeof r.redbark_id === "string" &&
          typeof r.category === "string" &&
          typeof r.merchant_clean === "string" &&
          typeof r.confidence === "number" &&
          typeof r.is_recurring === "boolean",
      )
      .map((r) => ({
        ...r,
        confidence: Math.max(0, Math.min(1, r.confidence)),
      }));

    console.log("AI categorise parsed", {
      requested: transactions.length,
      parsed: normalised.length,
      elapsedMs: Date.now() - startedAt,
    });

    return normalised;
  } catch (err) {
    console.warn("categoriseTransactions: JSON parse failed", {
      ids: transactions.map((t) => t.redbark_id).slice(0, 3),
      textLength: text.length,
      error: String(err),
      cleanedPreview: cleaned.slice(0, 300),
    });
    return [];
  }
}
