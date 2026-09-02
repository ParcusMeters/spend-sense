"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getMonthLabel } from "@/lib/utils/dates";
import {
  buildCategoryBreakdown,
  buildDailySpendingChartData,
  type TrendTxnLite,
} from "@/lib/dashboard/spending-chart-data";
import { MonthlyTrend } from "./MonthlyTrend";
import { DailySpendingCategoryChart } from "./DailySpendingCategoryChart";
import { SpendingChart } from "./SpendingChart";
import { Button } from "@/components/ui/button";

type TrendCategory = { key: string; name: string; color: string };

interface TrendAndDailySectionProps {
  monthlyTrendData: Record<string, string | number>[];
  monthlyTrendCategories: TrendCategory[];
  trendTxns: TrendTxnLite[];
  initialDailyData: Record<string, string | number>[];
  initialDailyCategories: TrendCategory[];
  /** Category wheel shown when no month is selected (server-computed, last 6 months). */
  defaultSpendingByCategory: { name: string; value: number; color: string }[];
  monthlyBudgetCents?: number | null;
  dailyBudgetCents?: number | null;
}

export function TrendAndDailySection({
  monthlyTrendData,
  monthlyTrendCategories,
  trendTxns,
  initialDailyData,
  initialDailyCategories,
  defaultSpendingByCategory,
  monthlyBudgetCents,
  dailyBudgetCents,
}: TrendAndDailySectionProps) {
  const router = useRouter();

  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);

  const monthDaily = useMemo(() => {
    if (!selectedMonthKey) return null;
    return buildDailySpendingChartData(trendTxns, {
      kind: "month",
      monthKey: selectedMonthKey,
    });
  }, [trendTxns, selectedMonthKey]);

  const displayDailyData = monthDaily?.data ?? initialDailyData;
  const displayDailyCategories = monthDaily?.categories ?? initialDailyCategories;

  // The wheel follows the same month selection as the daily chart, so clicking a
  // month re-cuts the category split instead of leaving a stale 6-month view.
  const monthCategories = useMemo(() => {
    if (!selectedMonthKey) return null;
    return buildCategoryBreakdown(trendTxns, {
      kind: "month",
      monthKey: selectedMonthKey,
    });
  }, [trendTxns, selectedMonthKey]);

  const isMonthSelected = Boolean(selectedMonthKey && /^\d{4}-\d{2}$/.test(selectedMonthKey));
  const monthLabel = isMonthSelected ? getMonthLabel(`${selectedMonthKey}-01`) : null;

  const dailyTitle = monthLabel
    ? `Daily Spending — ${monthLabel}`
    : "Daily Spending by Category";

  return (
    <div className="space-y-6">
      <SpendingChart
        data={monthCategories ?? defaultSpendingByCategory}
        title={
          monthLabel
            ? `Spending by Category — ${monthLabel}`
            : "Spending by Category (Last 6 Months)"
        }
        emptyLabel={monthLabel ?? "the last 6 months"}
      />
      <MonthlyTrend
        data={monthlyTrendData}
        categories={monthlyTrendCategories}
        selectedMonthKey={selectedMonthKey}
        onMonthClick={(monthKey) => {
          setSelectedMonthKey((prev) => (prev === monthKey ? null : monthKey));
        }}
        budgetCents={monthlyBudgetCents ?? undefined}
      />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {selectedMonthKey ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setSelectedMonthKey(null)}
            >
              Back to last 35 days
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Click a month above to view daily breakdown for that month.
            </span>
          )}
        </div>
        <DailySpendingCategoryChart
          title={dailyTitle}
          data={displayDailyData}
          categories={displayDailyCategories}
          budgetCents={dailyBudgetCents ?? undefined}
          onDayClick={(isoDate) => {
            const q = new URLSearchParams({ from: isoDate, to: isoDate });
            router.push(`/transactions?${q.toString()}`);
          }}
        />
      </div>
    </div>
  );
}
