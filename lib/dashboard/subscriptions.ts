import { differenceInCalendarDays, format, parseISO, subDays } from "date-fns";
import { getCategoryColor, isExcludedFromTotals, type TrendTxnLite } from "./spending-chart-data";

export type SubscriptionTxnLite = TrendTxnLite & {
  merchant: string | null;
  merchant_canonical?: string | null;
  is_recurring?: boolean | null;
};

export type SubscriptionRow = {
  name: string;
  category: string;
  color: string;
  charges: number;
  lastAmount: number;
  /** The charge before the most recent one, for a genuine price-change signal. */
  previousAmount: number | null;
  lastDate: string;
  daysSince: number;
  /** Median gap between charges; null when there is only one. */
  cadenceDays: number | null;
  cadenceLabel: string;
  /** Spend in the window scaled to a month — robust to irregular billing. */
  monthlyEstimate: number;
  totalInWindow: number;
  priceDelta: number;
  /** Silent for more than twice its usual gap: possibly finished or renamed. */
  dormant: boolean;
};

export type SubscriptionSummary = {
  start: string;
  end: string;
  windowDays: number;
  rows: SubscriptionRow[];
  /** Combined monthly run-rate of everything still being charged. */
  activeMonthlyEstimate: number;
  activeCount: number;
  dormantCount: number;
};

function effectiveCategory(t: SubscriptionTxnLite): string {
  return t.user_category_override ?? t.ai_category ?? t.redbark_category ?? "Other";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function cadenceLabelFor(days: number | null): string {
  if (days === null) return "one charge so far";
  if (days <= 9) return "weekly";
  if (days <= 18) return "fortnightly";
  if (days <= 45) return "monthly";
  if (days <= 100) return "quarterly";
  return "yearly";
}

/**
 * Recurring charges, grouped per merchant.
 *
 * The monthly figure is the window total scaled to 30 days rather than the last
 * charge times its cadence: merchants bill irregularly and often mix products
 * under one name (Optus here ranges $5 to $65), so scaling a single charge would
 * badly misstate the run-rate.
 */
export function buildSubscriptionSummary(
  txns: SubscriptionTxnLite[],
  options?: { windowDays?: number; today?: Date }
): SubscriptionSummary {
  const windowDays = options?.windowDays ?? 180;
  const today = options?.today ?? new Date();
  const end = format(today, "yyyy-MM-dd");
  const start = format(subDays(today, windowDays - 1), "yyyy-MM-dd");

  type Acc = {
    charges: { date: string; amount: number }[];
    categoryCounts: Record<string, number>;
  };

  const acc = new Map<string, Acc>();

  for (const t of txns) {
    if (!t.is_recurring) continue;
    if (t.direction !== "debit") continue;
    if (isExcludedFromTotals(t)) continue;
    if (t.date < start || t.date > end) continue;

    const name = (t.merchant_canonical ?? t.merchant ?? "").trim();
    if (!name) continue;

    let entry = acc.get(name);
    if (!entry) {
      entry = { charges: [], categoryCounts: {} };
      acc.set(name, entry);
    }
    entry.charges.push({ date: t.date, amount: Math.abs(t.amount_cents) });
    const cat = effectiveCategory(t);
    entry.categoryCounts[cat] = (entry.categoryCounts[cat] ?? 0) + 1;
  }

  const monthsInWindow = windowDays / 30;

  const rows: SubscriptionRow[] = [...acc.entries()].map(([name, entry]) => {
    const charges = [...entry.charges].sort((a, b) => a.date.localeCompare(b.date));
    const amounts = charges.map((c) => c.amount);
    const totalInWindow = amounts.reduce((a, b) => a + b, 0);

    const gaps: number[] = [];
    for (let i = 1; i < charges.length; i++) {
      gaps.push(differenceInCalendarDays(parseISO(charges[i].date), parseISO(charges[i - 1].date)));
    }
    const cadenceDays = median(gaps.filter((g) => g > 0));

    const last = charges[charges.length - 1];
    const previous = charges.length > 1 ? charges[charges.length - 2] : null;
    const daysSince = differenceInCalendarDays(today, parseISO(last.date));

    const category =
      Object.entries(entry.categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Other";

    return {
      name,
      category,
      color: getCategoryColor(category),
      charges: charges.length,
      lastAmount: last.amount,
      previousAmount: previous?.amount ?? null,
      lastDate: last.date,
      daysSince,
      cadenceDays,
      cadenceLabel: cadenceLabelFor(cadenceDays),
      monthlyEstimate: Math.round(totalInWindow / monthsInWindow),
      totalInWindow,
      priceDelta: previous ? last.amount - previous.amount : 0,
      dormant: cadenceDays !== null ? daysSince > cadenceDays * 2 : daysSince > 60,
    };
  });

  rows.sort((a, b) => {
    // Live subscriptions first — those are the ones there is a decision to make about.
    if (a.dormant !== b.dormant) return a.dormant ? 1 : -1;
    return b.monthlyEstimate - a.monthlyEstimate;
  });

  const active = rows.filter((r) => !r.dormant);

  return {
    start,
    end,
    windowDays,
    rows,
    activeMonthlyEstimate: active.reduce((sum, r) => sum + r.monthlyEstimate, 0),
    activeCount: active.length,
    dormantCount: rows.length - active.length,
  };
}
