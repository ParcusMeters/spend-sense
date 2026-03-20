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
    message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Categorise these Australian bank transactions. For each, return the category, confidence (0-1), whether it's recurring, and a cleaned merchant name.

Categories: ${CATEGORIES.join(", ")}

Transactions:
${txnList}

Reply with ONLY a JSON array:
[{"redbark_id":"...","category":"...","confidence":0.95,"is_recurring":false,"merchant_clean":"..."}]`,
        },
      ],
    });
  } catch (error) {
    console.error("AI categorise request failed", {
      count: transactions.length,
      sampleIds: transactions.map((t) => t.redbark_id).slice(0, 3),
      error: String(error),
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

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.warn("categoriseTransactions: no JSON array found", {
      ids: transactions.map((t) => t.redbark_id).slice(0, 3),
      textLength: text.length,
    });
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as CategorisationResult[];
    console.log("AI categorise parsed", {
      requested: transactions.length,
      parsed: parsed.length,
      elapsedMs: Date.now() - startedAt,
    });
    return parsed;
  } catch (err) {
    console.warn("categoriseTransactions: JSON parse failed", {
      ids: transactions.map((t) => t.redbark_id).slice(0, 3),
      error: String(err),
    });
    return [];
  }
}
