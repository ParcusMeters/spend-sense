import { format, subDays } from "date-fns";
import {
  getCategoryColor,
  isExcludedFromTotals,
  type TrendTxnLite,
} from "./spending-chart-data";

export type WeekTxnLite = TrendTxnLite & {
  description: string;
  merchant: string | null;
};

export type WeeklySummary = {
  start: string;
  end: string;
  totalCents: number;
  previousTotalCents: number;
  transactionCount: number;
  /** Spending categories over the window, largest first. */
  categories: { name: string; value: number; color: string; share: number }[];
  /** Where the money actually went, largest first. */
  merchants: { name: string; value: number; count: number }[];
  largest: { description: string; amountCents: number; date: string; category: string } | null;
  /** Days in the window with no spending at all. */
  noSpendDays: number;
};

function effectiveCategory(t: WeekTxnLite): string {
  return t.user_category_override ?? t.ai_category ?? t.redbark_category ?? "Other";
}

function isSpend(t: WeekTxnLite): boolean {
  return t.direction === "debit" && !isExcludedFromTotals(t);
}

/**
 * Summarises spending over a rolling window ending today (default 7 days), with the
 * immediately preceding window of the same length for comparison.
 *
 * Uses the same rules as the charts — debits only, transfers excluded — so the totals
 * here reconcile with the category wheel rather than telling a different story.
 */
export function buildWeeklySummary(
  txns: WeekTxnLite[],
  options?: { days?: number; today?: Date }
): WeeklySummary {
  const days = options?.days ?? 7;
  const today = options?.today ?? new Date();

  const end = format(today, "yyyy-MM-dd");
  const start = format(subDays(today, days - 1), "yyyy-MM-dd");
  const prevEnd = format(subDays(today, days), "yyyy-MM-dd");
  const prevStart = format(subDays(today, days * 2 - 1), "yyyy-MM-dd");

  const current = txns.filter((t) => t.date >= start && t.date <= end && isSpend(t));
  const previous = txns.filter((t) => t.date >= prevStart && t.date <= prevEnd && isSpend(t));

  const totalCents = current.reduce((sum, t) => sum + Math.abs(t.amount_cents), 0);
  const previousTotalCents = previous.reduce((sum, t) => sum + Math.abs(t.amount_cents), 0);

  const categoryTotals: Record<string, number> = {};
  const merchantTotals: Record<string, { value: number; count: number }> = {};
  const spendDays = new Set<string>();

  for (const t of current) {
    const amount = Math.abs(t.amount_cents);
    const cat = effectiveCategory(t);
    categoryTotals[cat] = (categoryTotals[cat] ?? 0) + amount;

    const label = (t.merchant ?? t.description ?? "Unknown").trim() || "Unknown";
    if (!merchantTotals[label]) merchantTotals[label] = { value: 0, count: 0 };
    merchantTotals[label].value += amount;
    merchantTotals[label].count += 1;

    spendDays.add(t.date);
  }

  const categories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({
      name,
      value,
      color: getCategoryColor(name),
      share: totalCents > 0 ? value / totalCents : 0,
    }));

  const merchants = Object.entries(merchantTotals)
    .sort((a, b) => b[1].value - a[1].value)
    .map(([name, { value, count }]) => ({ name, value, count }));

  const largestTxn = current.reduce<WeekTxnLite | null>(
    (best, t) => (!best || Math.abs(t.amount_cents) > Math.abs(best.amount_cents) ? t : best),
    null
  );

  return {
    start,
    end,
    totalCents,
    previousTotalCents,
    transactionCount: current.length,
    categories,
    merchants,
    largest: largestTxn
      ? {
          description: largestTxn.merchant ?? largestTxn.description,
          amountCents: Math.abs(largestTxn.amount_cents),
          date: largestTxn.date,
          category: effectiveCategory(largestTxn),
        }
      : null,
    noSpendDays: days - spendDays.size,
  };
}
