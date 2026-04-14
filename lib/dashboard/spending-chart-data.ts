import {
  eachDayOfInterval,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
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
};

export type DailyChartCategory = { key: string; name: string; color: string };

function effectiveCategory(t: TrendTxnLite): string {
  return t.ai_category ?? t.user_category_override ?? t.redbark_category ?? "Other";
}

export function buildDailySpendingChartData(
  txns: TrendTxnLite[],
  spec:
    | { kind: "rolling"; days: number; today?: Date }
    | { kind: "month"; monthKey: string }
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
    const cat = effectiveCategory(t);
    if (isTransferCategory(cat)) continue;

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

  const data = dates.map((d) => {
    const row: Record<string, string | number> = {
      date: d,
      label: calendarDayLabel(d),
    };
    for (const c of categories) {
      row[c.key] = dailyMap[d]?.[c.name] ?? 0;
    }
    return row;
  });

  return { data, categories };
}
