import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { syncRedbarkBalancesToDatabase } from "@/lib/redbark/sync-balances";

const anthropic = new Anthropic();

async function getBalancePromptBlock(supabase: SupabaseClient): Promise<{
  totalDollars: number;
  lines: string;
  data: { total_balance_dollars: number; accounts: { name: string; balance: number; currency: string }[] };
}> {
  const { data: rows } = await supabase
    .from("accounts")
    .select("redbark_name, institution, type, balance, currency")
    .order("redbark_name");

  const list = rows ?? [];
  const totalDollars = list.reduce((s, a) => s + Number(a.balance), 0);
  const lines =
    list.length === 0
      ? "- No accounts on file (balances not synced yet)."
      : list
          .map(
            (a) =>
              `- ${a.redbark_name} (${a.institution}, ${a.type}): $${Number(a.balance).toFixed(2)} ${(a.currency ?? "AUD").toUpperCase()}`
          )
          .join("\n");

  return {
    totalDollars,
    lines,
    data: {
      total_balance_dollars: totalDollars,
      accounts: list.map((a) => ({
        name: a.redbark_name,
        balance: Number(a.balance),
        currency: (a.currency ?? "AUD").toUpperCase(),
      })),
    },
  };
}

export async function generateDigest(
  type: "weekly" | "monthly" | "ad_hoc",
  startDate: string,
  endDate: string
): Promise<{ content: string; summary: string; data: Record<string, unknown> }> {
  const startedAt = Date.now();
  console.log("AI digest start", {
    type,
    startDate,
    endDate,
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });
  const supabase = createServiceClient();
  await syncRedbarkBalancesToDatabase(supabase);
  const balanceBlock = await getBalancePromptBlock(supabase);

  const { data: transactions } = await supabase
    .from("transactions")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: false });

  if (!transactions || transactions.length === 0) {
    console.log("AI digest skipped: no transactions", { type, startDate, endDate });
    const bal = balanceBlock.totalDollars.toFixed(2);
    return {
      content: `No transactions found for this period.\n\n## Current balances\n**Total across accounts:** $${bal}\n\n${balanceBlock.lines}`,
      summary: `No activity · total balance ~$${bal}`,
      data: { ...balanceBlock.data },
    };
  }

  const debits = transactions.filter((t) => t.direction === "debit");
  const credits = transactions.filter((t) => t.direction === "credit");
  const grossSpending = debits.reduce((sum, t) => sum + Math.abs(t.amount_cents), 0);
  const reimbursements = credits
    .filter((t) => t.ai_category === "Reimbursements")
    .reduce((sum, t) => sum + t.amount_cents, 0);
  const totalSpending = grossSpending - reimbursements;
  const totalIncome = credits
    .filter((t) => t.ai_category === "Salary")
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

  // For weekly digests, include the previous saved weekly insight as reference
  // (so Claude can comment on changes vs last week).
  let previousWeeklyInsight: { summary: string; content: string } | null = null;
  if (type === "weekly") {
    const { data: prev } = await supabase
      .from("insights")
      .select("summary,content,period_end")
      .eq("type", "weekly")
      .lt("period_end", startDate)
      .order("period_end", { ascending: false })
      .limit(1);

    const row = prev?.[0];
    if (row?.summary || row?.content) {
      previousWeeklyInsight = {
        summary: row.summary ?? "",
        content: row.content ?? "",
      };
    }
  }

  const prompt = `You are a personal finance analyst for Marcus, based in Perth, Australia. Generate a ${type} financial digest.

Period: ${startDate} to ${endDate}
Total transactions: ${transactions.length}
Total income: $${(totalIncome / 100).toFixed(2)}
Total spending: $${(totalSpending / 100).toFixed(2)}
Net saved: $${((totalIncome - totalSpending) / 100).toFixed(2)}

Current balances (as of this run — from linked accounts; use when relevant to runway, savings, or overall position):
Total across all accounts: $${balanceBlock.totalDollars.toFixed(2)}
Per account:
${balanceBlock.lines}

Top spending categories:
${topCategories}

Flagged anomalies: ${anomalyCount}

${type === "weekly" ? `Previous week analysis (reference only):
${previousWeeklyInsight?.summary ? `Summary: ${previousWeeklyInsight.summary}` : "Summary: N/A"}
${previousWeeklyInsight?.content ? previousWeeklyInsight.content.slice(0, 800) : ""}` : ""}

${type === "weekly" ? "Provide a concise weekly summary with spending patterns, notable transactions, and 2-3 actionable tips. Where it adds value, tie the period's cash flow to current balances (e.g. buffer, progress toward goals)." : ""}
${type === "monthly" ? "Provide a comprehensive monthly report with trend analysis, category breakdown, savings rate commentary, and 3-5 actionable recommendations. Where it adds value, relate the month to current total balance and per-account picture." : ""}
${type === "ad_hoc" ? "Provide an analytical summary of this period with key insights and patterns. Reference current balances if relevant." : ""}

Write in a friendly but professional tone. Use markdown formatting. Be specific with numbers. Marcus earns ~$5,841/month net and aims for a $20,000 savings goal.`;

  let message;
  try {
    message = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (error) {
    const e = error as {
      message?: string;
      status?: number;
      code?: string;
      response?: { status?: number; data?: { code?: string } };
    };
    console.error("AI digest request failed", {
      type,
      startDate,
      endDate,
      txCount: transactions.length,
      message: e?.message,
      status: e?.status ?? e?.response?.status,
      code: e?.code ?? e?.response?.data?.code,
      responseData: e?.response?.data ?? null,
    });
    // If Anthropic billing/credits are unavailable, fall back to a deterministic digest
    // so the endpoint doesn't 500.
    const incomeDollars = (totalIncome / 100).toFixed(2);
    const spendingDollars = (totalSpending / 100).toFixed(2);
    const netSavedDollars = ((totalIncome - totalSpending) / 100).toFixed(2);
    const typeLabel =
      type === "weekly" ? "Weekly" : type === "monthly" ? "Monthly" : "On-demand";

    const topCategoryLines = topCategories
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const topCategoryBullets =
      topCategoryLines.length > 0
        ? topCategoryLines.map((l) => `- ${l}`).join("\n")
        : "- None";

    const fallbackContent = `## ${typeLabel} Financial Digest

Period: ${startDate} to ${endDate}
Total income: $${incomeDollars}
Total spending: $${spendingDollars}
Net saved: $${netSavedDollars}

Current balances (total): $${balanceBlock.totalDollars.toFixed(2)}
${balanceBlock.lines}

Top spending categories:
${topCategoryBullets}

Flagged anomalies: ${anomalyCount}

Next steps:
- Review your top categories and consider setting/adjusting budgets.
- Double-check any flagged anomalies and ensure recurring charges are expected.
- If spending spikes, look for changes in recurring merchants.`;

    const fallbackSummary =
      fallbackContent
        .split("\n")
        .find((l) => l.trim().length > 0)
        ?.replace(/^#+\s*/, "")
        .slice(0, 200) ?? "Financial digest";

    return {
      content: fallbackContent,
      summary: fallbackSummary,
      data: {
        total_income: totalIncome,
        total_spending: totalSpending,
        net_saved: totalIncome - totalSpending,
        transaction_count: transactions.length,
        category_breakdown: categoryTotals,
        anomaly_count: anomalyCount,
        ...balanceBlock.data,
      },
    };
  }

  console.log("AI digest response received", {
    type,
    txCount: transactions.length,
    elapsedMs: Date.now() - startedAt,
    contentBlocks: message.content.length,
    stopReason: message.stop_reason,
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
      ...balanceBlock.data,
    },
  };
}
