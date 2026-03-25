"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getMonthLabel } from "@/lib/utils/dates";
import { buildDailySpendingChartData, type TrendTxnLite } from "@/lib/dashboard/spending-chart-data";
import { MonthlyTrend } from "./MonthlyTrend";
import { DailySpendingCategoryChart } from "./DailySpendingCategoryChart";
import { Button } from "@/components/ui/button";

type TrendCategory = { key: string; name: string; color: string };

interface TrendAndDailySectionProps {
  monthlyTrendData: Record<string, string | number>[];
  monthlyTrendCategories: TrendCategory[];
  trendTxns: TrendTxnLite[];
  initialDailyData: Record<string, string | number>[];
  initialDailyCategories: TrendCategory[];
}

export function TrendAndDailySection({
  monthlyTrendData,
  monthlyTrendCategories,
  trendTxns,
  initialDailyData,
  initialDailyCategories,
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

  const dailyTitle =
    selectedMonthKey && /^\d{4}-\d{2}$/.test(selectedMonthKey)
      ? `Daily Spending — ${getMonthLabel(`${selectedMonthKey}-01`)}`
      : "Daily Spending by Category";

  return (
    <div className="space-y-6">
      <MonthlyTrend
        data={monthlyTrendData}
        categories={monthlyTrendCategories}
        selectedMonthKey={selectedMonthKey}
        onMonthClick={(monthKey) => {
          setSelectedMonthKey((prev) => (prev === monthKey ? null : monthKey));
        }}
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
          onDayClick={(isoDate) => {
            const q = new URLSearchParams({ from: isoDate, to: isoDate });
            router.push(`/transactions?${q.toString()}`);
          }}
        />
      </div>
    </div>
  );
}
