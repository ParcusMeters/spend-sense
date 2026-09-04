import { getDate, startOfMonth, subMonths, format } from "date-fns";
import { isExcludedFromTotals, type TrendTxnLite } from "./spending-chart-data";

export type PaceFigure = {
  toDate: number;
  /** Average spend/income by this same point in previous complete months. */
  typical: number;
  delta: number;
  deltaPct: number | null;
};

export type MonthPace = {
  dayOfMonth: number;
  monthsCompared: number;
  spending: PaceFigure;
  income: PaceFigure;
  netSaved: PaceFigure;
};

function effectiveCategory(t: TrendTxnLite): string {
  return t.user_category_override ?? t.ai_category ?? t.redbark_category ?? "Other";
}

function figure(toDate: number, samples: number[]): PaceFigure {
  const typical =
    samples.length > 0
      ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
      : 0;
  const delta = toDate - typical;
  return {
    toDate,
    typical,
    delta,
    deltaPct: typical !== 0 ? Math.round((delta / Math.abs(typical)) * 100) : null,
  };
}

/**
 * This month so far, against the same stretch of previous months.
 *
 * Compares day 1-to-today against day 1-to-the-same-day in each prior month, not
 * against their finished totals. On the 2nd of the month a whole-month comparison
 * would show a 95% "drop" in everything, which says nothing about whether spending
 * is actually down.
 */
export function buildMonthPace(
  txns: TrendTxnLite[],
  options?: { today?: Date; months?: number }
): MonthPace {
  const today = options?.today ?? new Date();
  const months = options?.months ?? 3;
  const dayOfMonth = getDate(today);
  const currentMonthKey = format(today, "yyyy-MM");

  const priorKeys: string[] = [];
  for (let i = 1; i <= months; i++) {
    priorKeys.push(format(subMonths(startOfMonth(today), i), "yyyy-MM"));
  }
  const priorSet = new Set(priorKeys);

  const spendByMonth = new Map<string, number>();
  const incomeByMonth = new Map<string, number>();

  for (const t of txns) {
    // Only the same stretch of the month, so the comparison is like for like.
    if (Number(t.date.slice(8, 10)) > dayOfMonth) continue;

    const monthKey = t.date.slice(0, 7);
    if (monthKey !== currentMonthKey && !priorSet.has(monthKey)) continue;

    if (t.direction === "debit") {
      if (isExcludedFromTotals(t)) continue;
      spendByMonth.set(monthKey, (spendByMonth.get(monthKey) ?? 0) + Math.abs(t.amount_cents));
    } else if (t.direction === "credit") {
      if (t.is_internal_transfer) continue;
      if (effectiveCategory(t) !== "Salary") continue;
      incomeByMonth.set(monthKey, (incomeByMonth.get(monthKey) ?? 0) + t.amount_cents);
    }
  }

  const spendSamples = priorKeys.map((k) => spendByMonth.get(k) ?? 0);
  const incomeSamples = priorKeys.map((k) => incomeByMonth.get(k) ?? 0);
  const netSamples = priorKeys.map(
    (k) => (incomeByMonth.get(k) ?? 0) - (spendByMonth.get(k) ?? 0)
  );

  const spendToDate = spendByMonth.get(currentMonthKey) ?? 0;
  const incomeToDate = incomeByMonth.get(currentMonthKey) ?? 0;

  return {
    dayOfMonth,
    monthsCompared: months,
    spending: figure(spendToDate, spendSamples),
    income: figure(incomeToDate, incomeSamples),
    netSaved: figure(incomeToDate - spendToDate, netSamples),
  };
}
