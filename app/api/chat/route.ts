import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createUserClient } from "@/lib/supabase/server";
import { syncRedbarkBalancesToDatabase } from "@/lib/redbark/sync-balances";
import { format, subMonths } from "date-fns";

const anthropic = new Anthropic();

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Messages required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = await createUserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    await syncRedbarkBalancesToDatabase(supabase);
    const now = new Date();
    const threeMonthsAgo = format(subMonths(now, 3), "yyyy-MM-dd");
    const today = format(now, "yyyy-MM-dd");

    const [
      { data: profile },
      { data: recentTransactions },
      { data: monthlySummaries },
      { data: accounts },
      { data: recurringTxns },
    ] = await Promise.all([
      supabase
        .from("user_profiles")
        .select("display_name, monthly_income_cents, savings_goal_cents")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("transactions")
        .select("date,description,amount_cents,direction,ai_category,merchant,is_recurring,is_anomaly")
        .eq("user_id", user.id)
        .gte("date", threeMonthsAgo)
        .order("date", { ascending: false })
        .limit(500),
      supabase
        .from("monthly_summaries")
        .select("*")
        .eq("user_id", user.id)
        .order("month", { ascending: false })
        .limit(6),
      supabase.from("accounts").select("redbark_name,institution,type,balance,currency").eq("user_id", user.id),
      supabase
        .from("transactions")
        .select("description,amount_cents,direction,ai_category,merchant")
        .eq("user_id", user.id)
        .eq("is_recurring", true)
        .gte("date", threeMonthsAgo)
        .order("date", { ascending: false })
        .limit(50),
    ]);

    const displayName = profile?.display_name ?? user.email?.split("@")[0] ?? "the user";
    const monthlyIncome = profile?.monthly_income_cents
      ? `$${(profile.monthly_income_cents / 100).toFixed(0)}/month net`
      : "unknown income";
    const savingsGoal = profile?.savings_goal_cents
      ? `$${(profile.savings_goal_cents / 100).toFixed(0)} savings goal`
      : "no savings goal set";

    const txns = recentTransactions ?? [];
    const grossSpending = txns
      .filter((t) => t.direction === "debit")
      .reduce((s, t) => s + Math.abs(t.amount_cents), 0);
    const reimbursements = txns
      .filter((t) => t.direction === "credit" && t.ai_category === "Reimbursements")
      .reduce((s, t) => s + t.amount_cents, 0);
    const totalSpending = grossSpending - reimbursements;
    const totalIncome = txns
      .filter((t) => t.direction === "credit" && t.ai_category === "Salary")
      .reduce((s, t) => s + t.amount_cents, 0);

    const categoryTotals: Record<string, number> = {};
    for (const t of txns.filter((t) => t.direction === "debit")) {
      const cat = t.ai_category ?? "Other";
      if (cat === "Transfers") continue;
      categoryTotals[cat] = (categoryTotals[cat] ?? 0) + Math.abs(t.amount_cents);
    }

    const topCategories = Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, cents]) => `${cat}: $${(cents / 100).toFixed(2)}`)
      .join(", ");

    const recurringSet = new Map<string, { description: string; amount: number; category: string }>();
    for (const t of recurringTxns ?? []) {
      const key = (t.merchant ?? t.description).toLowerCase();
      if (!recurringSet.has(key)) {
        recurringSet.set(key, {
          description: t.merchant ?? t.description,
          amount: Math.abs(t.amount_cents) / 100,
          category: t.ai_category ?? "Other",
        });
      }
    }
    const recurringList = [...recurringSet.values()]
      .map((r) => `${r.description}: $${r.amount.toFixed(2)} (${r.category})`)
      .join(", ");

    const accountsSummary = (accounts ?? [])
      .map(
        (a) =>
          `${a.redbark_name} (${a.institution}, ${a.type}): $${Number(a.balance).toFixed(2)}`
      )
      .join("; ");

    const monthlySummary = (monthlySummaries ?? [])
      .map(
        (m) =>
          `${m.month}: income $${m.total_income.toFixed(2)}, spending $${m.total_spending.toFixed(2)}, saved $${m.total_saved.toFixed(2)} (${(m.savings_rate * 100).toFixed(1)}%)`
      )
      .join("; ");

    const recentSample = txns
      .slice(0, 100)
      .map(
        (t) =>
          `${t.date} | ${t.direction === "debit" ? "-" : "+"}$${(Math.abs(t.amount_cents) / 100).toFixed(2)} | ${t.merchant ?? t.description} | ${t.ai_category ?? "Uncategorised"}`
      )
      .join("\n");

    const systemPrompt = `You are SpendSense, a personal finance assistant for ${displayName} based in Australia. You have access to their real bank transaction data. Answer questions conversationally, be specific with numbers, and give actionable advice when relevant.

The user earns approximately ${monthlyIncome} and has a ${savingsGoal}.

FINANCIAL CONTEXT (last 3 months, as of ${today}):

Accounts: ${accountsSummary || "No account data available"}

Period totals (last 3 months):
- Total income: $${(totalIncome / 100).toFixed(2)}
- Total spending: $${(totalSpending / 100).toFixed(2)}
- Net: $${((totalIncome - totalSpending) / 100).toFixed(2)}

Spending by category: ${topCategories || "No spending data"}

Monthly summaries: ${monthlySummary || "No monthly data yet"}

Recurring payments: ${recurringList || "None detected"}

Recent transactions (last 100):
${recentSample || "No transactions available"}

RULES:
- Be concise but thorough. Use dollar amounts, not cents.
- If asked about a specific merchant or category, search through the transaction data provided.
- If you don't have enough data to answer confidently, say so.
- Use markdown for formatting when helpful (lists, bold for key numbers).
- Keep responses focused — this is a chat, not an essay.`;

    const stream = await anthropic.messages.stream({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      thinking: { type: "disabled" },
      system: systemPrompt,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
              );
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          console.error("Chat stream error", err);
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat route error", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
