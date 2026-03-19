export const dynamic = "force-dynamic";

import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentMonth, getLastNMonths, getMonthLabel } from "@/lib/utils/dates";
import { BalanceCards } from "@/components/dashboard/BalanceCards";
import { MonthlyTrend } from "@/components/dashboard/MonthlyTrend";
import { SpendingChart } from "@/components/dashboard/SpendingChart";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { SavingsProjection } from "@/components/dashboard/SavingsProjection";
import { DashboardRealtime } from "@/components/dashboard/DashboardRealtime";
import { format, addMonths, startOfMonth } from "date-fns";

const CATEGORY_COLORS: Record<string, string> = {
  Groceries: "#5DCAA5",
  "Eating out": "#ED93B1",
  "Drinks & nightlife": "#D4537E",
  Transport: "#F0997B",
  Subscriptions: "#378ADD",
  Entertainment: "#FAC775",
  Health: "#AFA9EC",
  Shopping: "#534AB7",
  Travel: "#5DCAA5",
  "Bank fees": "#B4B2A9",
  Investing: "#1D9E75",
  Other: "#888780",
};

export default async function Dashboard() {
  const supabase = createServiceClient();
  const { start: monthStart, end: monthEnd } = getCurrentMonth();
  const { start: sixMonthStart } = getLastNMonths(6);

  // Fetch current month transactions
  const { data: monthTxns } = await supabase
    .from("transactions")
    .select("*")
    .gte("date", monthStart)
    .lte("date", monthEnd);

  const txns = monthTxns ?? [];
  const incomeThisMonth = txns
    .filter(
      (t) =>
        t.direction === "credit" &&
        (t.ai_category ?? t.redbark_category) !== "Transfers"
    )
    .reduce((sum, t) => sum + t.amount_cents, 0);

  const spendingThisMonth = txns
    .filter(
      (t) =>
        t.direction === "debit" &&
        (t.user_category_override ?? t.ai_category ?? t.redbark_category) !== "Transfers"
    )
    .reduce((sum, t) => sum + Math.abs(t.amount_cents), 0);

  // Fetch account balances
  const { data: accounts } = await supabase.from("accounts").select("balance");
  const totalBalance = (accounts ?? []).reduce(
    (sum, a) => sum + Number(a.balance) * 100,
    0
  );

  // Spending by category (current month)
  const categoryMap: Record<string, number> = {};
  for (const t of txns) {
    if (t.direction !== "debit") continue;
    const cat =
      t.user_category_override ?? t.ai_category ?? t.redbark_category ?? "Other";
    if (cat === "Transfers") continue;
    categoryMap[cat] = (categoryMap[cat] ?? 0) + Math.abs(t.amount_cents);
  }
  const spendingByCategory = Object.entries(categoryMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({
      name,
      value,
      color: CATEGORY_COLORS[name] ?? "#888780",
    }));

  // Monthly trend (last 6 months)
  const { data: allTxns } = await supabase
    .from("transactions")
    .select("date, direction, amount_cents, ai_category, redbark_category, user_category_override")
    .gte("date", sixMonthStart)
    .lte("date", monthEnd);

  const monthlyData: Record<string, { income: number; spending: number }> = {};
  for (const t of allTxns ?? []) {
    const m = t.date.slice(0, 7);
    if (!monthlyData[m]) monthlyData[m] = { income: 0, spending: 0 };
    const cat = t.user_category_override ?? t.ai_category ?? t.redbark_category;
    if (cat === "Transfers") continue;
    if (t.direction === "credit") {
      monthlyData[m].income += t.amount_cents;
    } else {
      monthlyData[m].spending += Math.abs(t.amount_cents);
    }
  }
  const trendData = Object.entries(monthlyData)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, data]) => ({
      month: getMonthLabel(`${month}-01`),
      income: Math.round(data.income / 100),
      spending: Math.round(data.spending / 100),
    }));

  // Savings projection
  const avgMonthlyIncome =
    trendData.length > 0
      ? trendData.reduce((s, d) => s + d.income, 0) / trendData.length
      : 5841;
  const avgMonthlySpending =
    trendData.length > 0
      ? trendData.reduce((s, d) => s + d.spending, 0) / trendData.length
      : 3085;
  const avgMonthlySaved = avgMonthlyIncome - avgMonthlySpending;
  const currentSavings = totalBalance / 100;

  const projectionData = Array.from({ length: 13 }, (_, i) => {
    const date = addMonths(startOfMonth(new Date()), i);
    return {
      month: format(date, "MMM yy"),
      projected: Math.round(currentSavings + avgMonthlySaved * i),
      ...(i === 0 ? { actual: Math.round(currentSavings) } : {}),
    };
  });

  // Recent transactions
  const { data: recentTxns } = await supabase
    .from("transactions")
    .select("*")
    .order("date", { ascending: false })
    .limit(20);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Your financial overview</p>
      </div>

      <BalanceCards
        totalBalance={totalBalance}
        incomeThisMonth={incomeThisMonth}
        spendingThisMonth={spendingThisMonth}
        netSaved={incomeThisMonth - spendingThisMonth}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MonthlyTrend data={trendData} />
        <SpendingChart data={spendingByCategory} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecentTransactions transactions={recentTxns ?? []} />
        <SavingsProjection
          data={projectionData}
          savingsGoal={20000}
        />
      </div>

      <DashboardRealtime />
    </div>
  );
}
