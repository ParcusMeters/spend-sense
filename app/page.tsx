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
import { TrendAndDailySection } from "@/components/dashboard/TrendAndDailySection";
import { WeeklySummary } from "@/components/dashboard/WeeklySummary";
import { TopMerchants } from "@/components/dashboard/TopMerchants";
import {
  getCategoryColor,
  isExcludedFromTotals,
  isReimbursementCategory,
  buildDailySpendingChartData,
} from "@/lib/dashboard/spending-chart-data";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { SavingsProjection } from "@/components/dashboard/SavingsProjection";
import { DashboardRealtime } from "@/components/dashboard/DashboardRealtime";
import { AuthGate } from "@/components/auth/AuthGate";
import { format, addMonths, startOfMonth, subDays, getDay, getDate, getDaysInMonth } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Repeat } from "lucide-react";
import { formatCurrency } from "@/lib/utils/currency";
import {
  fetchRedbarkTotalBalanceCents,
  syncRedbarkBalancesToDatabase,
} from "@/lib/redbark/sync-balances";
import { SpendingGoalTracker } from "@/components/dashboard/SpendingGoalTracker";
import { getCurrentWeek } from "@/lib/utils/dates";
import { buildWeeklySummary, type WeekTxnLite } from "@/lib/dashboard/weekly-summary";
import {
  buildMerchantLeaderboard,
  type MerchantTxnLite,
} from "@/lib/dashboard/merchant-summary";
import { RunCategoriseButton } from "@/components/dashboard/RunCategoriseButton";
import { CategorisationStatus } from "@/components/dashboard/CategorisationStatus";

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
  const effectiveCategory = (t: {
    user_category_override: string | null;
    ai_category: string | null;
    redbark_category: string | null;
  }) => t.user_category_override ?? t.ai_category ?? t.redbark_category ?? "Other";

  const incomeThisMonth = txns
    .filter(
      (t) =>
        t.direction === "credit" &&
        !t.is_internal_transfer &&
        effectiveCategory(t) === "Salary"
    )
    .reduce((sum, t) => sum + t.amount_cents, 0);

  const grossSpendingThisMonth = txns
    .filter((t) => t.direction === "debit" && !isExcludedFromTotals(t))
    .reduce((sum, t) => sum + Math.abs(t.amount_cents), 0);

  const reimbursementsThisMonth = txns
    .filter(
      (t) =>
        t.direction === "credit" &&
        !t.is_internal_transfer &&
        isReimbursementCategory(effectiveCategory(t))
    )
    .reduce((sum, t) => sum + t.amount_cents, 0);

  const spendingThisMonth = grossSpendingThisMonth - reimbursementsThisMonth;

  const recurringSpendingThisMonth = txns
    .filter(
      (t) => t.direction === "debit" && t.is_recurring === true && !isExcludedFromTotals(t)
    )
    .reduce((sum, t) => sum + Math.abs(t.amount_cents), 0);

  // Weekly spending for spending goal tracker
  const { start: weekStart, end: weekEnd } = getCurrentWeek();
  const { data: weekTxns } = await supabase
    .from("transactions")
    .select(
      "amount_cents, direction, ai_category, redbark_category, user_category_override, is_internal_transfer"
    )
    .gte("date", weekStart)
    .lte("date", weekEnd);

  const grossWeeklySpending = (weekTxns ?? [])
    .filter((t) => t.direction === "debit" && !isExcludedFromTotals(t))
    .reduce((sum, t) => sum + Math.abs(t.amount_cents), 0);

  const weeklyReimbursements = (weekTxns ?? [])
    .filter(
      (t) =>
        t.direction === "credit" &&
        !t.is_internal_transfer &&
        isReimbursementCategory(effectiveCategory(t))
    )
    .reduce((sum, t) => sum + t.amount_cents, 0);

  const weeklySpending = grossWeeklySpending - weeklyReimbursements;

  // Days into week (Mon=1 .. Sun=7)
  const today = new Date();
  const jsDay = getDay(today); // 0=Sun, 1=Mon...6=Sat
  const daysIntoWeek = jsDay === 0 ? 7 : jsDay;
  const daysIntoMonth = getDate(today);
  const daysInMonth = getDaysInMonth(today);

  // Fetch account balances (prefer live Redbark total, fallback to local snapshot)
  const liveTotalBalance = await fetchRedbarkTotalBalanceCents();
  const { data: accounts } = await supabase.from("accounts").select("balance");
  const fallbackTotalBalance = (accounts ?? []).reduce(
    (sum, a) => sum + Number(a.balance) * 100,
    0
  );
  const totalBalance = liveTotalBalance ?? fallbackTotalBalance;

  // Spending by category (last 6 months) - computed from `allTxns` below.
  let spendingByCategory: { name: string; value: number; color: string }[] = [];

  // Monthly trend (last 6 months)
  const { data: allTxns } = await supabase
    .from("transactions")
    .select(
      "date, direction, amount_cents, ai_category, redbark_category, user_category_override, is_internal_transfer"
    )
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
    is_internal_transfer: boolean | null;
  }[] = [];

  if (firstTxn?.date && lastTxn?.date && monthKeys.length > 0) {
    for (let offset = 0; ; offset += TREND_PAGE) {
      const { data: page, error: trendPageError } = await supabase
        .from("transactions")
        .select(
          "date, direction, amount_cents, ai_category, redbark_category, user_category_override, is_internal_transfer"
        )
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
    const cat = effectiveCategory(t);
    if (isExcludedFromTotals(t)) continue;
    categoryMap[cat] = (categoryMap[cat] ?? 0) + Math.abs(t.amount_cents);
  }
  const sortedCategories = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
  spendingByCategory = sortedCategories.map(([name, value]) => ({
    name,
    value,
    color: getCategoryColor(name),
  }));

  const { data: dailySpendingData, categories: dailyCategories } =
    buildDailySpendingChartData(trendTxns, {
      kind: "rolling",
      days: 35,
    });

  // One window covering both the 7-day summary and the 90-day merchant leaderboard,
  // each of which needs its own comparison period. Selects description/merchant,
  // which the trend query does not.
  const spendWindowStart = format(subDays(new Date(), 179), "yyyy-MM-dd");
  const { data: spendWindowTxns } = await supabase
    .from("transactions")
    .select(
      "date, direction, amount_cents, ai_category, redbark_category, user_category_override, is_internal_transfer, description, merchant, merchant_canonical"
    )
    .gte("date", spendWindowStart)
    .order("date", { ascending: false });

  const weeklySummary = buildWeeklySummary((spendWindowTxns ?? []) as WeekTxnLite[]);
  const merchantLeaderboard = buildMerchantLeaderboard(
    (spendWindowTxns ?? []) as MerchantTxnLite[],
    { days: 90, limit: 10 }
  );

  const monthIncomeMap: Record<string, number> = {};
  const monthSpendMap: Record<string, Record<string, number>> = {};
  const monthCategoryTotals: Record<string, number> = {};
  const monthKeySet = new Set(monthKeys);

  for (const t of trendTxns ?? []) {
    const monthKey = transactionMonthKey(t.date);
    if (!monthKey || !monthKeySet.has(monthKey)) continue;
    const cat = effectiveCategory(t);
    if (isExcludedFromTotals(t)) continue;

    if (t.direction === "credit" && cat === "Salary") {
      monthIncomeMap[monthKey] = (monthIncomeMap[monthKey] ?? 0) + t.amount_cents;
    } else if (t.direction === "credit" && isReimbursementCategory(cat)) {
      // Reimbursements reduce the spending total — show as negative spending
      if (!monthSpendMap[monthKey]) monthSpendMap[monthKey] = {};
      monthSpendMap[monthKey][cat] =
        (monthSpendMap[monthKey][cat] ?? 0) - t.amount_cents;
      monthCategoryTotals[cat] =
        (monthCategoryTotals[cat] ?? 0) - t.amount_cents;
    } else if (t.direction === "debit") {
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
    const cat = effectiveCategory(t);
    if (isExcludedFromTotals(t)) continue;
    if (t.direction === "credit" && cat === "Salary") {
      monthlyData[m].income += t.amount_cents;
    } else if (t.direction === "credit" && isReimbursementCategory(cat)) {
      monthlyData[m].spending -= t.amount_cents;
    } else if (t.direction === "debit") {
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

  // Spending budget for chart reference lines
  const { data: budgetRow } = await supabase
    .from("spending_budgets")
    .select("weekly_limit_cents")
    .limit(1)
    .maybeSingle();
  const weeklyBudgetCents = budgetRow?.weekly_limit_cents ?? null;
  const monthlyBudgetCents = weeklyBudgetCents ? Math.round(weeklyBudgetCents * 4.33) : null;
  const dailyBudgetCents = weeklyBudgetCents ? Math.round(weeklyBudgetCents / 7) : null;

  // Recent transactions
  const { data: recentTxns } = await supabase
    .from("transactions")
    .select("*")
    .order("date", { ascending: false })
    .limit(20);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground">Your financial overview</p>
          </div>
          <RunCategoriseButton />
        </div>
      </div>

      <CategorisationStatus />

      <BalanceCards
        totalBalance={totalBalance}
        incomeThisMonth={incomeThisMonth}
        spendingThisMonth={spendingThisMonth}
        netSaved={incomeThisMonth - spendingThisMonth}
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <SpendingGoalTracker
          weeklySpendingCents={weeklySpending}
          monthlySpendingCents={spendingThisMonth}
          daysIntoWeek={daysIntoWeek}
          daysIntoMonth={daysIntoMonth}
          daysInMonth={daysInMonth}
        />
        <Card className="min-w-0">
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
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <WeeklySummary summary={weeklySummary} />
        <TopMerchants leaderboard={merchantLeaderboard} />
      </div>

      <TrendAndDailySection
        monthlyTrendData={monthlyTrendData}
        monthlyTrendCategories={monthlyTrendCategories}
        trendTxns={trendTxns}
        initialDailyData={dailySpendingData}
        initialDailyCategories={dailyCategories}
        defaultSpendingByCategory={spendingByCategory}
        monthlyBudgetCents={monthlyBudgetCents}
        dailyBudgetCents={dailyBudgetCents}
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
