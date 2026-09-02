import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
} from "date-fns";
import { transactionMonthKey } from "@/lib/utils/dates";

/** Label for a DB calendar date (`yyyy-MM-dd`) without UTC midnight parseISO shifts. */
function calendarDayLabel(ymd: string): string {
  const [y, m, day] = ymd.split("-").map(Number);
  if (!y || !m || !day) return ymd;
  return format(new Date(y, m - 1, day), "d MMM");
}

export const CATEGORY_COLORS: Record<string, string> = {
  Groceries: "#5DCAA5",
  "Eating out": "#ED93B1",
  "Drinks & nightlife": "#D4537E",
  Transport: "#F0997B",
  Rent: "#E0655A",
  "Bills & utilities": "#9BBF5C",
  Subscriptions: "#378ADD",
  Entertainment: "#FAC775",
  Health: "#AFA9EC",
  Shopping: "#534AB7",
  Travel: "#5DCAA5",
  "Bank fees": "#B4B2A9",
  Investing: "#1D9E75",
  Reimbursements: "#60C9DB",
  Other: "#888780",
};

export function isTransferCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  const value = category.toLowerCase();
  return value.includes("transfer") || value.includes("xfer");
}

export function isReimbursementCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return category.toLowerCase() === "reimbursements";
}

export function getCategoryColor(name: string): string {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  const hash = name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return `hsl(${hash % 360} 75% 55%)`;
}

export type TrendTxnLite = {
  date: string;
  direction: string;
  amount_cents: number;
  ai_category: string | null;
  redbark_category: string | null;
  user_category_override: string | null;
  /** Set by refresh_internal_transfers(): a move between the user's own accounts. */
  is_internal_transfer?: boolean | null;
};

/**
 * Money moving between the user's own accounts is neither income nor spending —
 * counting it in either direction just inflates both sides of the picture.
 *
 * Excluded on two grounds: the structural flag, which is computed in the database
 * and does not depend on the categoriser getting it right, and a transfer-ish
 * category, which is kept so a manual override still works.
 */
export function isExcludedFromTotals(t: {
  is_internal_transfer?: boolean | null;
  user_category_override?: string | null;
  ai_category?: string | null;
  redbark_category?: string | null;
}): boolean {
  if (t.is_internal_transfer) return true;
  const cat = t.user_category_override ?? t.ai_category ?? t.redbark_category ?? "Other";
  return isTransferCategory(cat);
}

export type DailyChartCategory = { key: string; name: string; color: string };

function effectiveCategory(t: TrendTxnLite): string {
  return t.user_category_override ?? t.ai_category ?? t.redbark_category ?? "Other";
}

/**
 * Spending per category over a month or an explicit date range, using the same
 * rules as the daily chart: debits only, transfers excluded, override > ai > bank.
 */
export function buildCategoryBreakdown(
  txns: TrendTxnLite[],
  spec: { kind: "month"; monthKey: string } | { kind: "range"; start: string; end: string }
): { name: string; value: number; color: string }[] {
  const totals: Record<string, number> = {};

  for (const t of txns) {
    if (t.direction !== "debit") continue;
    if (isExcludedFromTotals(t)) continue;
    const cat = effectiveCategory(t);

    if (spec.kind === "month") {
      if (transactionMonthKey(t.date) !== spec.monthKey) continue;
    } else if (t.date < spec.start || t.date > spec.end) {
      continue;
    }

    totals[cat] = (totals[cat] ?? 0) + Math.abs(t.amount_cents);
  }

  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value, color: getCategoryColor(name) }));
}

export type ChartGranularity = "day" | "week";

/**
 * Buckets the range by day or by Mon-Sun week.
 *
 * Weeks are clamped to the range so a partial week at either edge still totals
 * only what falls inside it — the two granularities always sum to the same
 * amount for the same range.
 */
function buildBuckets(
  dates: string[],
  granularity: ChartGranularity
): { key: string; end: string; label: string; days: string[] }[] {
  if (granularity === "day") {
    return dates.map((d) => ({ key: d, end: d, label: calendarDayLabel(d), days: [d] }));
  }

  const rangeStart = dates[0]!;
  const rangeEnd = dates[dates.length - 1]!;
  const byWeek = new Map<string, string[]>();

  for (const d of dates) {
    const weekStart = format(startOfWeek(parseISO(d), { weekStartsOn: 1 }), "yyyy-MM-dd");
    const existing = byWeek.get(weekStart);
    if (existing) existing.push(d);
    else byWeek.set(weekStart, [d]);
  }

  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, days]) => {
      const weekEnd = format(endOfWeek(parseISO(weekStart), { weekStartsOn: 1 }), "yyyy-MM-dd");
      const start = weekStart < rangeStart ? rangeStart : weekStart;
      const end = weekEnd > rangeEnd ? rangeEnd : weekEnd;
      return {
        key: start,
        end,
        label: `${calendarDayLabel(start)} – ${calendarDayLabel(end)}`,
        days,
      };
    });
}

export function buildDailySpendingChartData(
  txns: TrendTxnLite[],
  spec:
    | { kind: "rolling"; days: number; today?: Date; granularity?: ChartGranularity }
    | { kind: "month"; monthKey: string; granularity?: ChartGranularity }
): {
  data: Record<string, string | number>[];
  categories: DailyChartCategory[];
} {
  const today = spec.kind === "rolling" ? (spec.today ?? new Date()) : new Date();

  let dates: string[];
  if (spec.kind === "rolling") {
    const n = spec.days;
    dates = Array.from({ length: n }, (_, i) =>
      format(subDays(today, n - 1 - i), "yyyy-MM-dd")
    );
  } else {
    const start = startOfMonth(parseISO(`${spec.monthKey}-01`));
    const end = endOfMonth(start);
    dates = eachDayOfInterval({ start, end }).map((d) => format(d, "yyyy-MM-dd"));
  }

  const rangeStart = dates[0]!;
  const rangeEnd = dates[dates.length - 1]!;

  const dailyMap: Record<string, Record<string, number>> = {};
  const dailyCategoryTotals: Record<string, number> = {};

  for (const t of txns) {
    if (t.direction !== "debit") continue;
    if (isExcludedFromTotals(t)) continue;
    const cat = effectiveCategory(t);

    if (spec.kind === "month") {
      if (transactionMonthKey(t.date) !== spec.monthKey) continue;
    } else {
      if (t.date < rangeStart || t.date > rangeEnd) continue;
    }

    if (!dailyMap[t.date]) dailyMap[t.date] = {};
    dailyMap[t.date][cat] = (dailyMap[t.date][cat] ?? 0) + Math.abs(t.amount_cents);
    dailyCategoryTotals[cat] = (dailyCategoryTotals[cat] ?? 0) + Math.abs(t.amount_cents);
  }

  const categories: DailyChartCategory[] = Object.entries(dailyCategoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name], idx) => ({
      key: `cat_${idx}`,
      name,
      color: getCategoryColor(name),
    }));

  const buckets = buildBuckets(dates, spec.granularity ?? "day");

  const data = buckets.map((bucket) => {
    const row: Record<string, string | number> = {
      date: bucket.key,
      // Range the bucket covers, so a click can filter to the whole week.
      rangeEnd: bucket.end,
      label: bucket.label,
    };
    for (const c of categories) {
      let total = 0;
      for (const day of bucket.days) {
        total += dailyMap[day]?.[c.name] ?? 0;
      }
      row[c.key] = total;
    }
    return row;
  });

  return { data, categories };
}
