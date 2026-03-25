export const dynamic = "force-dynamic";

import { createServiceClient } from "@/lib/supabase/server";
import {
  getCurrentMonth,
  getLastNMonths,
  getMonthLabel,
  monthKeysBetweenInclusive,
  transactionMonthKey,
} from "@/lib/utils/dates";
import { BalanceCards } from "@/components/dashboard/BalanceCards";
import { MonthlyTrend } from "@/components/dashboard/MonthlyTrend";
import { SpendingChart } from "@/components/dashboard/SpendingChart";
import { DailySpendingCategoryChart } from "@/components/dashboard/DailySpendingCategoryChart";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { SavingsProjection } from "@/components/dashboard/SavingsProjection";
import { DashboardRealtime } from "@/components/dashboard/DashboardRealtime";
import { AuthGate } from "@/components/auth/AuthGate";
import { format, addMonths, startOfMonth, subDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Repeat } from "lucide-react";
import { formatCurrency } from "@/lib/utils/currency";
import { syncRedbarkBalancesToDatabase } from "@/lib/redbark/sync-balances";

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

function isTransferCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  const value = category.toLowerCase();
  return value.includes("transfer") || value.includes("xfer");
}

function getCategoryColor(name: string): string {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  const hash = name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return `hsl(${hash % 360} 75% 55%)`;
}

async function DashboardContent() {
  const supabase = createServiceClient();
  await syncRedbarkBalancesToDatabase(supabase);
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
        !isTransferCategory(
          t.ai_category ?? t.user_category_override ?? t.redbark_category
        )
    )
    .reduce((sum, t) => sum + t.amount_cents, 0);

  const spendingThisMonth = txns
    .filter(
      (t) =>
        t.direction === "debit" &&
        !isTransferCategory(
          t.ai_category ?? t.user_category_override ?? t.redbark_category
        )
    )
    .reduce((sum, t) => sum + Math.abs(t.amount_cents), 0);

  const recurringSpendingThisMonth = txns
    .filter(
      (t) =>
        t.direction === "debit" &&
        t.is_recurring === true &&
        !isTransferCategory(
          t.ai_category ?? t.user_category_override ?? t.redbark_category
        )
    )
    .reduce((sum, t) => sum + Math.abs(t.amount_cents), 0);

  // Fetch account balances
  const { data: accounts } = await supabase.from("accounts").select("balance");
  const totalBalance = (accounts ?? []).reduce(
    (sum, a) => sum + Number(a.balance) * 100,
    0
  );

  // Spending by category (last 6 months) - computed from `allTxns` below.
  let spendingByCategory: { name: string; value: number; color: string }[] = [];

  // Monthly trend (last 6 months)
  const { data: allTxns } = await supabase
    .from("transactions")
    .select("date, direction, amount_cents, ai_category, redbark_category, user_category_override")
    .gte("date", sixMonthStart)
    .lte("date", monthEnd);

  // Monthly trend: full history (paginated — Supabase caps at 1000 rows per request)
  const TREND_PAGE = 1000;
  const { data: firstTxn } = await supabase
    .from("transactions")
    .select("date")
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();
  const { data: lastTxn } = await supabase
    .from("transactions")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const firstMonthKey = transactionMonthKey(firstTxn?.date ?? null);
  const lastMonthKey = transactionMonthKey(lastTxn?.date ?? null);

  const monthKeys =
    firstMonthKey && lastMonthKey
      ? monthKeysBetweenInclusive(firstMonthKey, lastMonthKey)
      : [];

  const trendTxns: {
    date: string;
    direction: string;
    amount_cents: number;
    ai_category: string | null;
    redbark_category: string | null;
    user_category_override: string | null;
  }[] = [];

  if (firstTxn?.date && lastTxn?.date && monthKeys.length > 0) {
    for (let offset = 0; ; offset += TREND_PAGE) {
      const { data: page, error: trendPageError } = await supabase
        .from("transactions")
        .select("date, direction, amount_cents, ai_category, redbark_category, user_category_override")
        .gte("date", firstTxn.date)
        .lte("date", lastTxn.date)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + TREND_PAGE - 1);

      if (trendPageError) {
        console.error("dashboard: monthly trend page fetch failed", trendPageError);
        break;
      }
      if (!page?.length) break;
      trendTxns.push(...page);
      if (page.length < TREND_PAGE) break;
    }
  }

  const categoryMap: Record<string, number> = {};
  for (const t of allTxns ?? []) {
    if (t.direction !== "debit") continue;
    // Prefer AI categories for the dashboard chart.
    const cat = t.ai_category ?? t.user_category_override ?? t.redbark_category ?? "Other";
    if (isTransferCategory(cat)) continue;
    categoryMap[cat] = (categoryMap[cat] ?? 0) + Math.abs(t.amount_cents);
  }
  const sortedCategories = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
  spendingByCategory = sortedCategories.map(([name, value]) => ({
    name,
    value,
    color: getCategoryColor(name),
  }));

  // Daily spending by category (last 35 days, stacked bars)
  const dailyWindowDays = 35;
  const dailyStart = subDays(new Date(), dailyWindowDays - 1);
  const dailyStartStr = format(dailyStart, "yyyy-MM-dd");
  const dailyDates = Array.from({ length: dailyWindowDays }, (_, i) =>
    format(subDays(new Date(), dailyWindowDays - 1 - i), "yyyy-MM-dd")
  );

  const dailyMap: Record<string, Record<string, number>> = {};
  const dailyCategoryTotals: Record<string, number> = {};
  for (const t of allTxns ?? []) {
    if (t.direction !== "debit") continue;
    if (t.date < dailyStartStr) continue;
    const cat = t.ai_category ?? t.user_category_override ?? t.redbark_category ?? "Other";
    if (isTransferCategory(cat)) continue;
    if (!dailyMap[t.date]) dailyMap[t.date] = {};
    dailyMap[t.date][cat] = (dailyMap[t.date][cat] ?? 0) + Math.abs(t.amount_cents);
    dailyCategoryTotals[cat] = (dailyCategoryTotals[cat] ?? 0) + Math.abs(t.amount_cents);
  }

  const dailyCategories = Object.entries(dailyCategoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name], idx) => ({
      key: `cat_${idx}`,
      name,
      color: getCategoryColor(name),
    }));

  const dailySpendingData = dailyDates.map((d) => {
    const row: Record<string, string | number> = {
      date: d,
      label: format(new Date(`${d}T00:00:00`), "d MMM"),
    };
    for (const c of dailyCategories) {
      row[c.key] = dailyMap[d]?.[c.name] ?? 0;
    }
    return row;
  });

  const monthIncomeMap: Record<string, number> = {};
  const monthSpendMap: Record<string, Record<string, number>> = {};
  const monthCategoryTotals: Record<string, number> = {};
  const monthKeySet = new Set(monthKeys);

  for (const t of trendTxns ?? []) {
    const monthKey = transactionMonthKey(t.date);
    if (!monthKey || !monthKeySet.has(monthKey)) continue;
    const cat = t.ai_category ?? t.user_category_override ?? t.redbark_category ?? "Other";
    if (isTransferCategory(cat)) continue;

    if (t.direction === "credit") {
      monthIncomeMap[monthKey] = (monthIncomeMap[monthKey] ?? 0) + t.amount_cents;
    } else {
      if (!monthSpendMap[monthKey]) monthSpendMap[monthKey] = {};
      monthSpendMap[monthKey][cat] =
        (monthSpendMap[monthKey][cat] ?? 0) + Math.abs(t.amount_cents);
      monthCategoryTotals[cat] =
        (monthCategoryTotals[cat] ?? 0) + Math.abs(t.amount_cents);
    }
  }

  const monthlyTrendCategories = Object.entries(monthCategoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name], idx) => ({
      key: `cat_${idx}`,
      name,
      color: getCategoryColor(name),
    }));

  const monthCategoryKeyByName = new Map(
    monthlyTrendCategories.map((c) => [c.name, c.key])
  );

  const monthlyTrendData = monthKeys.map((monthKey) => {
    const row: Record<string, string | number> = {
      monthKey,
      monthLabel: getMonthLabel(`${monthKey}-01`),
      income: monthIncomeMap[monthKey] ?? 0,
    };
    const spendForMonth = monthSpendMap[monthKey] ?? {};
    for (const [name, cents] of Object.entries(spendForMonth)) {
      const key = monthCategoryKeyByName.get(name);
      if (key) row[key] = cents;
    }
    for (const c of monthlyTrendCategories) {
      if (row[c.key] === undefined) row[c.key] = 0;
    }
    return row;
  });

  const monthlyData: Record<string, { income: number; spending: number }> = {};
  for (const t of allTxns ?? []) {
    const m = transactionMonthKey(t.date);
    if (!m) continue;
    if (!monthlyData[m]) monthlyData[m] = { income: 0, spending: 0 };
    const cat = t.ai_category ?? t.user_category_override ?? t.redbark_category;
    if (isTransferCategory(cat)) continue;
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

      <Card className="w-full">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Monthly Recurring Payments
          </CardTitle>
          <div className="rounded-lg bg-purple-50 p-2 dark:bg-purple-950">
            <Repeat className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">
            {formatCurrency(recurringSpendingThisMonth)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Total recurring debit payments detected this month.
          </p>
        </CardContent>
      </Card>

      <SpendingChart data={spendingByCategory} />

      <MonthlyTrend data={monthlyTrendData} categories={monthlyTrendCategories} />

      <DailySpendingCategoryChart
        data={dailySpendingData}
        categories={dailyCategories}
      />

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

export default function Dashboard() {
  return (
    <AuthGate>
      <DashboardContent />
    </AuthGate>
  );
}
