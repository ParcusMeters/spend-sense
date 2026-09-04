import { format, startOfMonth, subMonths } from "date-fns";
import { getCategoryColor, isExcludedFromTotals, type TrendTxnLite } from "./spending-chart-data";

export type CategoryTrendPoint = { key: string; label: string; total: number };

export type CategoryTrend = {
  name: string;
  color: string;
  /** Complete months only, oldest first. */
  points: CategoryTrendPoint[];
  /** Most recent complete month. */
  latest: number;
  /** Mean of the complete months before the latest one. */
  average: number;
  delta: number;
  deltaPct: number | null;
  peak: number;
  windowTotal: number;
  /** Spend so far in the current, incomplete month — reported, never compared. */
  monthToDate: number;
};

export type CategoryTrendsResult = {
  trends: CategoryTrend[];
  /** Label of the most recent complete month, e.g. "Aug 2026". */
  latestMonthLabel: string;
  monthsCompared: number;
  daysIntoCurrentMonth: number;
};

function effectiveCategory(t: TrendTxnLite): string {
  return t.user_category_override ?? t.ai_category ?? t.redbark_category ?? "Other";
}

/**
 * Per-category monthly history, for small-multiple sparklines.
 *
 * Deliberately built from *complete* months only. The current month is a partial
 * one — two days in, it would read as a collapse in every category — so it is
 * reported separately as month-to-date and never enters the average or the delta.
 */
export function buildCategoryTrends(
  txns: TrendTxnLite[],
  options?: { months?: number; today?: Date; limit?: number }
): CategoryTrendsResult {
  const months = options?.months ?? 6;
  const limit = options?.limit ?? 9;
  const today = options?.today ?? new Date();

  const currentMonthKey = format(today, "yyyy-MM");
  const monthKeys: string[] = [];
  for (let i = months; i >= 1; i--) {
    monthKeys.push(format(subMonths(startOfMonth(today), i), "yyyy-MM"));
  }
  const monthLabels = new Map(
    monthKeys.map((k) => [k, format(new Date(`${k}-01T00:00:00`), "MMM")])
  );
  const included = new Set(monthKeys);

  const byCategory = new Map<string, { totals: Map<string, number>; monthToDate: number }>();

  for (const t of txns) {
    if (t.direction !== "debit") continue;
    if (isExcludedFromTotals(t)) continue;

    const monthKey = t.date.slice(0, 7);
    const isCurrent = monthKey === currentMonthKey;
    if (!isCurrent && !included.has(monthKey)) continue;

    const name = effectiveCategory(t);
    let entry = byCategory.get(name);
    if (!entry) {
      entry = { totals: new Map(), monthToDate: 0 };
      byCategory.set(name, entry);
    }

    const amount = Math.abs(t.amount_cents);
    if (isCurrent) {
      entry.monthToDate += amount;
    } else {
      entry.totals.set(monthKey, (entry.totals.get(monthKey) ?? 0) + amount);
    }
  }

  const trends: CategoryTrend[] = [...byCategory.entries()].map(([name, entry]) => {
    const points = monthKeys.map((key) => ({
      key,
      label: monthLabels.get(key) ?? key,
      total: entry.totals.get(key) ?? 0,
    }));

    const latest = points[points.length - 1]?.total ?? 0;
    const prior = points.slice(0, -1);
    const average =
      prior.length > 0 ? prior.reduce((sum, p) => sum + p.total, 0) / prior.length : 0;
    const delta = latest - average;

    return {
      name,
      color: getCategoryColor(name),
      points,
      latest,
      average: Math.round(average),
      delta: Math.round(delta),
      deltaPct: average > 0 ? Math.round((delta / average) * 100) : null,
      peak: points.reduce((max, p) => (p.total > max ? p.total : max), 0),
      windowTotal: points.reduce((sum, p) => sum + p.total, 0),
      monthToDate: entry.monthToDate,
    };
  });

  trends.sort((a, b) => b.windowTotal - a.windowTotal);

  return {
    trends: trends.filter((t) => t.windowTotal > 0).slice(0, limit),
    latestMonthLabel: format(subMonths(startOfMonth(today), 1), "MMM yyyy"),
    monthsCompared: months,
    daysIntoCurrentMonth: today.getDate(),
  };
}
