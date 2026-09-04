import { format, subDays } from "date-fns";
import { getCategoryColor, isExcludedFromTotals, type TrendTxnLite } from "./spending-chart-data";

export type MerchantTxnLite = TrendTxnLite & {
  description: string;
  merchant: string | null;
  /** Grouped merchant name from refresh_merchant_canonical(). */
  merchant_canonical?: string | null;
};

export type MerchantRow = {
  name: string;
  /** Spend in the window. */
  total: number;
  count: number;
  average: number;
  /** Spend in the immediately preceding window of the same length. */
  previousTotal: number;
  /** Category this merchant is most often filed under, for colour. */
  category: string;
  color: string;
  lastDate: string;
};

export type MerchantLeaderboard = {
  start: string;
  end: string;
  days: number;
  rows: MerchantRow[];
  /** Total spend in the window, so each row's share can be shown. */
  windowTotal: number;
};

function effectiveCategory(t: MerchantTxnLite): string {
  return t.user_category_override ?? t.ai_category ?? t.redbark_category ?? "Other";
}

function merchantName(t: MerchantTxnLite): string {
  const name = (t.merchant_canonical ?? t.merchant ?? "").trim();
  return name || "Uncategorised merchant";
}

/**
 * Where the money actually goes, by merchant, over a rolling window.
 *
 * Groups on merchant_canonical so variants of one merchant ("Cursor AI" and
 * "Cursor AI Powered IDE") count once. Uses the same exclusions as the charts, so
 * a transfer between the user's own accounts never appears as a merchant.
 */
export function buildMerchantLeaderboard(
  txns: MerchantTxnLite[],
  options?: { days?: number; today?: Date; limit?: number }
): MerchantLeaderboard {
  const days = options?.days ?? 90;
  const limit = options?.limit ?? 10;
  const today = options?.today ?? new Date();

  const end = format(today, "yyyy-MM-dd");
  const start = format(subDays(today, days - 1), "yyyy-MM-dd");
  const prevEnd = format(subDays(today, days), "yyyy-MM-dd");
  const prevStart = format(subDays(today, days * 2 - 1), "yyyy-MM-dd");

  const isSpend = (t: MerchantTxnLite) => t.direction === "debit" && !isExcludedFromTotals(t);

  type Acc = {
    total: number;
    count: number;
    previousTotal: number;
    lastDate: string;
    categoryCounts: Record<string, number>;
  };

  const acc = new Map<string, Acc>();
  const ensure = (name: string): Acc => {
    let entry = acc.get(name);
    if (!entry) {
      entry = { total: 0, count: 0, previousTotal: 0, lastDate: "", categoryCounts: {} };
      acc.set(name, entry);
    }
    return entry;
  };

  let windowTotal = 0;

  for (const t of txns) {
    if (!isSpend(t)) continue;
    const amount = Math.abs(t.amount_cents);
    const name = merchantName(t);

    if (t.date >= start && t.date <= end) {
      const entry = ensure(name);
      entry.total += amount;
      entry.count += 1;
      if (t.date > entry.lastDate) entry.lastDate = t.date;
      const cat = effectiveCategory(t);
      entry.categoryCounts[cat] = (entry.categoryCounts[cat] ?? 0) + 1;
      windowTotal += amount;
    } else if (t.date >= prevStart && t.date <= prevEnd) {
      ensure(name).previousTotal += amount;
    }
  }

  const rows: MerchantRow[] = [...acc.entries()]
    // Only merchants seen in the current window; a name carried in solely by the
    // comparison period would otherwise show as a row with no spend.
    .filter(([, v]) => v.count > 0)
    .map(([name, v]) => {
      const category =
        Object.entries(v.categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Other";
      return {
        name,
        total: v.total,
        count: v.count,
        average: Math.round(v.total / v.count),
        previousTotal: v.previousTotal,
        category,
        color: getCategoryColor(category),
        lastDate: v.lastDate,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);

  return { start, end, days, rows, windowTotal };
}
