import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";

const anthropic = new Anthropic();

export async function generateDigest(
  type: "weekly" | "monthly" | "ad_hoc",
  startDate: string,
  endDate: string
): Promise<{ content: string; summary: string; data: Record<string, unknown> }> {
  const supabase = createServiceClient();

  const { data: transactions } = await supabase
    .from("transactions")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: false });

  if (!transactions || transactions.length === 0) {
    return {
      content: "No transactions found for this period.",
      summary: "No activity",
      data: {},
    };
  }

  const debits = transactions.filter((t) => t.direction === "debit");
  const credits = transactions.filter((t) => t.direction === "credit");
  const totalSpending = debits.reduce((sum, t) => sum + Math.abs(t.amount_cents), 0);
  const totalIncome = credits
    .filter((t) => !["Transfers"].includes(t.ai_category ?? ""))
    .reduce((sum, t) => sum + t.amount_cents, 0);

  const categoryTotals: Record<string, number> = {};
  for (const t of debits) {
    const cat = t.user_category_override ?? t.ai_category ?? t.redbark_category ?? "Other";
    if (cat === "Transfers") continue;
    categoryTotals[cat] = (categoryTotals[cat] ?? 0) + Math.abs(t.amount_cents);
  }

  const topCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([cat, cents]) => `${cat}: $${(cents / 100).toFixed(2)}`)
    .join("\n");

  const anomalyCount = transactions.filter((t) => t.is_anomaly).length;

  const prompt = `You are a personal finance analyst for Marcus, based in Perth, Australia. Generate a ${type} financial digest.

Period: ${startDate} to ${endDate}
Total transactions: ${transactions.length}
Total income: $${(totalIncome / 100).toFixed(2)}
Total spending: $${(totalSpending / 100).toFixed(2)}
Net saved: $${((totalIncome - totalSpending) / 100).toFixed(2)}

Top spending categories:
${topCategories}

Flagged anomalies: ${anomalyCount}

${type === "weekly" ? "Provide a concise weekly summary with spending patterns, notable transactions, and 2-3 actionable tips." : ""}
${type === "monthly" ? "Provide a comprehensive monthly report with trend analysis, category breakdown, savings rate commentary, and 3-5 actionable recommendations." : ""}
${type === "ad_hoc" ? "Provide an analytical summary of this period with key insights and patterns." : ""}

Write in a friendly but professional tone. Use markdown formatting. Be specific with numbers. Marcus earns ~$5,841/month net and aims for a $20,000 savings goal.`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const content = message.content[0].type === "text" ? message.content[0].text : "";
  const summaryLine = content.split("\n").find((l) => l.trim().length > 0) ?? "Financial digest";

  return {
    content,
    summary: summaryLine.replace(/^#+\s*/, "").slice(0, 200),
    data: {
      total_income: totalIncome,
      total_spending: totalSpending,
      net_saved: totalIncome - totalSpending,
      transaction_count: transactions.length,
      category_breakdown: categoryTotals,
      anomaly_count: anomalyCount,
    },
  };
}
