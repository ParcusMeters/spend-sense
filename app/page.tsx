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
import { Subscriptions } from "@/components/dashboard/Subscriptions";
import { CategoryTrends } from "@/components/dashboard/CategoryTrends";
import {
  getCategoryColor,
  isExcludedFromTotals,
  isIncomeCategory,
  isReimbursementCategory,
  buildDailySpendingChartData,
} from "@/lib/dashboard/spending-chart-data";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { SavingsProjection } from "@/components/dashboard/SavingsProjection";
import { DashboardRealtime } from "@/components/dashboard/DashboardRealtime";
import { AuthGate } from "@/components/auth/AuthGate";
import {
  format,
  addMonths,
  startOfMonth,
  subDays,
  subMonths,
  getDay,
  getDate,
  getDaysInMonth,
} from "date-fns";
import {
  syncRedbarkBalancesToDatabase,
} from "@/lib/redbark/sync-balances";
import { SpendingGoalTracker } from "@/components/dashboard/SpendingGoalTracker";
import { getCurrentWeek } from "@/lib/utils/dates";
import { buildWeeklySummary, type WeekTxnLite } from "@/lib/dashboard/weekly-summary";
import {
  buildMerchantLeaderboard,
  type MerchantTxnLite,
} from "@/lib/dashboard/merchant-summary";
import {
  buildSubscriptionSummary,
  type SubscriptionTxnLite,
} from "@/lib/dashboard/subscriptions";
import { buildCategoryTrends } from "@/lib/dashboard/category-trends";
import { buildMonthPace } from "@/lib/dashboard/month-pace";
import { buildInvestmentFlow } from "@/lib/dashboard/investment-flow";
import { RunCategoriseButton } from "@/components/dashboard/RunCategoriseButton";
import { CategorisationStatus } from "@/components/dashboard/CategorisationStatus";

/**
 * How much history the trend chart and the client-side month drill-down cover.
 * Two years keeps the query and the serialised payload bounded as the table grows.
 */
const TREND_MONTHS = 24;

/**
 * PostgREST caps a response at 1000 rows and says nothing about having done so —
 * a query over more than that silently returns a prefix. Both the trend window
 * and the 180-day spend window are already past it, so they have to be paged.
 */
const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  label: string
): Promise<T[]> {
  const rows: T[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await page(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.error(`dashboard: ${label} page fetch failed`, error);
      break;
    }
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  return rows;
}

async function DashboardContent() {
  const supabase = createServiceClient();
  const { start: monthStart, end: monthEnd } = getCurrentMonth();
  const { start: sixMonthStart } = getLastNMonths(6);
  const { start: weekStart, end: weekEnd } = getCurrentWeek();

  // The balance sync calls the Redbark API, and the reads below do not depend on
  // it, so it runs alongside them rather than in front of them. Balances are read
  // afterwards, so they still reflect this sync.
  const balancesSynced = syncRedbarkBalancesToDatabase(supabase);

  const spendWindowStart = format(subDays(new Date(), 179), "yyyy-MM-dd");
  const trendStart = format(subMonths(startOfMonth(new Date()), TREND_MONTHS - 1), "yyyy-MM-dd");

  const [
    { data: monthTxns },
    { data: weekTxns },
    { data: allTxns },
    spendWindowTxns,
    { data: budgetRow },
    { data: recentTxns },
    trendPages,
  ] = await Promise.all([
    supabase.from("transactions").select("*").gte("date", monthStart).lte("date", monthEnd),
    supabase
      .from("transactions")
      .select(
        "amount_cents, direction, ai_category, redbark_category, user_category_override, is_internal_transfer, is_investment_flow"
      )
      .gte("date", weekStart)
      .lte("date", weekEnd),
    supabase
      .from("transactions")
      .select(
        "date, direction, amount_cents, ai_category, redbark_category, user_category_override, is_internal_transfer, is_investment_flow"
      )
      .gte("date", sixMonthStart)
      .lte("date", monthEnd),
    fetchAllRows(
      (from, to) =>
        supabase
          .from("transactions")
          .select(
            "date, direction, amount_cents, ai_category, redbark_category, user_category_override, is_internal_transfer, is_investment_flow, is_recurring, description, merchant, merchant_canonical"
          )
          .gte("date", spendWindowStart)
          .order("date", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      "spend window"
    ),
    supabase.from("spending_budgets").select("weekly_limit_cents").limit(1).maybeSingle(),
    supabase
      .from("transactions")
      .select("*")
      .order("date", { ascending: false })
      .limit(20),
    fetchAllRows(
      (from, to) =>
        supabase
          .from("transactions")
          .select(
            "date, direction, amount_cents, ai_category, redbark_category, user_category_override, is_internal_transfer, is_investment_flow"
          )
          .gte("date", trendStart)
          .order("date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      "monthly trend"
    ),
  ]);

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
        !t.is_investment_flow &&
        isIncomeCategory(effectiveCategory(t))
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

  // Balances come from the table once the sync above has written them, rather
  // than from a second call to the same Redbark endpoints.
  await balancesSynced;
  const { data: accounts } = await supabase.from("accounts").select("balance");
  const totalBalance = (accounts ?? []).reduce(
    (sum, a) => sum + Number(a.balance) * 100,
    0
  );

  // Spending by category (last 6 months) - computed from `allTxns` below.
  let spendingByCategory: { name: string; value: number; color: string }[] = [];

  // Monthly trend. Bounded to TREND_MONTHS rather than walking the whole table:
  // this set is also serialised to the client for the daily chart, so an unbounded
  // history would make both the query and the payload grow forever.
  const trendTxns = trendPages as {
    date: string;
    direction: string;
    amount_cents: number;
    ai_category: string | null;
    redbark_category: string | null;
    user_category_override: string | null;
    is_internal_transfer: boolean | null;
    is_investment_flow: boolean | null;
  }[];

  const firstMonthKey = transactionMonthKey(trendTxns[0]?.date ?? null);
  const lastMonthKey = transactionMonthKey(
    trendTxns[trendTxns.length - 1]?.date ?? null
  );

  const monthKeys =
    firstMonthKey && lastMonthKey
      ? monthKeysBetweenInclusive(firstMonthKey, lastMonthKey)
      : [];

  const categoryMap: Record<string, number> = {};
  for (const t of trendTxns) {
    if (t.date < sixMonthStart || t.date > monthEnd) continue;
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

  const categoryTrends = buildCategoryTrends(trendTxns, { months: 6, limit: 9 });
  const monthPace = buildMonthPace(trendTxns, { months: 3 });
  const investmentFlow = buildInvestmentFlow(trendTxns, { months: 6 });

  const { data: dailySpendingData, categories: dailyCategories } =
    buildDailySpendingChartData(trendTxns, {
      kind: "rolling",
      days: 35,
    });

  const weeklySummary = buildWeeklySummary((spendWindowTxns ?? []) as WeekTxnLite[]);
  const merchantLeaderboard = buildMerchantLeaderboard(
    (spendWindowTxns ?? []) as MerchantTxnLite[],
    { days: 90, limit: 10 }
  );
  const subscriptionSummary = buildSubscriptionSummary(
    (spendWindowTxns ?? []) as SubscriptionTxnLite[],
    { windowDays: 180 }
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

    if (t.direction === "credit" && !t.is_investment_flow && isIncomeCategory(cat)) {
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
    if (t.direction === "credit" && !t.is_investment_flow && isIncomeCategory(cat)) {
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

  const weeklyBudgetCents = budgetRow?.weekly_limit_cents ?? null;
  const monthlyBudgetCents = weeklyBudgetCents ? Math.round(weeklyBudgetCents * 4.33) : null;
  const dailyBudgetCents = weeklyBudgetCents ? Math.round(weeklyBudgetCents / 7) : null;

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
        pace={monthPace}
        investedThisMonth={investmentFlow.monthToDate.net}
      />

      {/* Spending over time first: the shape of the habit is the thing being
          tracked, and everything below explains or breaks down what it shows. */}
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

      {/* Am I on track right now? */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SpendingGoalTracker
          weeklySpendingCents={weeklySpending}
          monthlySpendingCents={spendingThisMonth}
          daysIntoWeek={daysIntoWeek}
          daysIntoMonth={daysIntoMonth}
          daysInMonth={daysInMonth}
        />
        <WeeklySummary summary={weeklySummary} />
      </div>

      {/* What is drifting, month over month. */}
      <CategoryTrends result={categoryTrends} />

      {/* Where it actually goes, and what recurs. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TopMerchants leaderboard={merchantLeaderboard} />
        <Subscriptions summary={subscriptionSummary} />
      </div>

      {/* Reference: detail and outlook rather than day-to-day tracking. */}
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
