"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getMonthLabel } from "@/lib/utils/dates";
import {
  buildCategoryBreakdown,
  buildDailySpendingChartData,
  type ChartGranularity,
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
  const [granularity, setGranularity] = useState<ChartGranularity>("day");

  // The server already rendered the default view (rolling days), so only rebuild
  // when the selection or granularity moves away from it.
  const recomputed = useMemo(() => {
    if (!selectedMonthKey && granularity === "day") return null;
    return buildDailySpendingChartData(
      trendTxns,
      selectedMonthKey
        ? { kind: "month", monthKey: selectedMonthKey, granularity }
        : { kind: "rolling", days: 35, granularity }
    );
  }, [trendTxns, selectedMonthKey, granularity]);

  const displayDailyData = recomputed?.data ?? initialDailyData;
  const displayDailyCategories = recomputed?.categories ?? initialDailyCategories;

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

  const spendingNoun = granularity === "week" ? "Weekly" : "Daily";
  const dailyTitle = monthLabel
    ? `${spendingNoun} Spending — ${monthLabel}`
    : `${spendingNoun} Spending by Category`;

  return (
    <div className="space-y-6">
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
              Click a month above to view the breakdown for that month.
            </span>
          )}

          <div className="inline-flex rounded-md border p-0.5" role="group">
            {(["day", "week"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={granularity === option ? "secondary" : "ghost"}
                className="h-7 px-3 text-xs"
                aria-pressed={granularity === option}
                onClick={() => setGranularity(option)}
              >
                {option === "day" ? "Daily" : "Weekly"}
              </Button>
            ))}
          </div>
        </div>
        {/* The wheel answers "on what" for the same period the bars cover, so it
            sits beside them rather than in its own full-width row. */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <DailySpendingCategoryChart
              title={dailyTitle}
              data={displayDailyData}
              categories={displayDailyCategories}
              budgetCents={dailyBudgetCents ?? undefined}
              bucketNoun={granularity}
              onRangeClick={(fromIso, toIso) => {
                const q = new URLSearchParams({ from: fromIso, to: toIso });
                router.push(`/transactions?${q.toString()}`);
              }}
            />
          </div>
          <SpendingChart
            layout="stack"
            data={monthCategories ?? defaultSpendingByCategory}
            title={monthLabel ? `Categories — ${monthLabel}` : "Categories (Last 6 Months)"}
            emptyLabel={monthLabel ?? "the last 6 months"}
          />
        </div>
      </div>
    </div>
  );
}
