"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMonthLabel } from "@/lib/utils/dates";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface MonthlyTrendProps {
  data: Record<string, string | number>[];
  categories: {
    key: string;
    name: string;
    color: string;
  }[];
  /** When set, non-matching months are dimmed; click toggles selection in parent. */
  selectedMonthKey?: string | null;
  onMonthClick?: (monthKey: string) => void;
}

interface TrendTooltipEntry {
  name?: string | number;
  value?: string | number | null;
  color?: string;
  payload?: Record<string, unknown>;
}

interface TrendTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TrendTooltipEntry[];
}

function MonthlyTrendTooltip({ active, label, payload }: TrendTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const nonZero = payload.filter((p) => Number(p.value ?? 0) > 0);
  if (nonZero.length === 0) return null;

  const row = payload[0]?.payload as { monthLabel?: string; monthKey?: string } | undefined;
  const header =
    row?.monthLabel ??
    (typeof row?.monthKey === "string" && /^\d{4}-\d{2}$/.test(row.monthKey)
      ? getMonthLabel(`${row.monthKey}-01`)
      : String(label ?? ""));

  return (
    <div className="rounded-lg border bg-card p-2 text-xs shadow-sm">
      <p className="mb-1 font-medium">{header}</p>
      <div className="space-y-1">
        {nonZero.map((p) => (
          <div key={String(p.name)} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: p.color ?? "currentColor" }}
              />
              {String(p.name)}
            </span>
            <span className="font-medium">
              $
              {(Number(p.value ?? 0) / 100).toLocaleString("en-AU", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const CHART_HEIGHT = 320;
/** Horizontal space per month (2× prior); chart min width grows with month count so bars are not squashed — scroll for more history. */
const PX_PER_MONTH = 104;
const CHART_FLOOR_WIDTH = 560;
/** Fixed pixel gap between month groups (not %) so bar thickness stays driven by minWidth ÷ months. */
const BAR_CATEGORY_GAP_PX = 20;

export function MonthlyTrend({
  data,
  categories,
  selectedMonthKey = null,
  onMonthClick,
}: MonthlyTrendProps) {
  const hasData = data.length > 0;
  const chartMinWidth = Math.max(CHART_FLOOR_WIDTH, data.length * PX_PER_MONTH);

  function barOpacityForIndex(index: number): number {
    const mk = data[index]?.monthKey;
    if (!selectedMonthKey || typeof mk !== "string") return 1;
    return mk === selectedMonthKey ? 1 : 0.35;
  }

  function handleMonthBarClick(_: unknown, index: number) {
    const mk = data[index]?.monthKey;
    if (typeof mk === "string" && onMonthClick) onMonthClick(mk);
  }

  const maxMonthlyCents = data.reduce((max, row) => {
    const income = Number(row.income ?? 0);
    const spending = categories.reduce(
      (sum, c) => sum + Number(row[c.key] ?? 0),
      0
    );
    return Math.max(max, income, spending);
  }, 0);
  const niceMaxCents =
    maxMonthlyCents > 0 ? Math.ceil(maxMonthlyCents / 50000) * 50000 : 100000;
  const yTicks = Array.from({ length: 5 }, (_, i) =>
    Math.round(niceMaxCents - (niceMaxCents * i) / 4)
  );

  return (
    <Card className="w-full min-w-0">
      <CardHeader>
        <CardTitle>Income vs Spending</CardTitle>
        {onMonthClick && (
          <p className="text-xs font-normal text-muted-foreground">
            Click a month to show its daily spending below. Click again to clear.
          </p>
        )}
      </CardHeader>
      <CardContent className="min-w-0">
        {!hasData ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No monthly trend data yet.
          </p>
        ) : (
          <div className="flex w-full min-w-0 gap-2">
            <div className="w-16 shrink-0 border-r pr-2">
              <div className="relative" style={{ height: CHART_HEIGHT }}>
                {yTicks.map((tick, i) => (
                  <span
                    key={tick}
                    className="absolute right-0 -translate-y-1/2 text-xs text-muted-foreground"
                    style={{ top: `${(i / (yTicks.length - 1)) * 100}%` }}
                  >
                    ${Math.round(tick / 100)}
                  </span>
                ))}
              </div>
            </div>

            <div className="min-w-0 w-full flex-1 overflow-x-auto">
              <div
                style={{
                  width: "100%",
                  minWidth: chartMinWidth,
                  height: CHART_HEIGHT,
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data}
                    barGap={4}
                    barCategoryGap={BAR_CATEGORY_GAP_PX}
                    margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      type="category"
                      dataKey="monthKey"
                      tickFormatter={(mk) =>
                        typeof mk === "string" && /^\d{4}-\d{2}$/.test(mk)
                          ? getMonthLabel(`${mk}-01`)
                          : String(mk ?? "")
                      }
                      minTickGap={data.length > 20 ? 4 : 8}
                      className="text-xs"
                      tick={{ fill: "var(--muted-foreground)" }}
                    />
                    <Tooltip content={<MonthlyTrendTooltip />} />
                    <Bar
                      dataKey="income"
                      name="Income"
                      fill="hsl(152, 69%, 31%)"
                      radius={[4, 4, 0, 0]}
                      cursor={onMonthClick ? "pointer" : "default"}
                      onClick={onMonthClick ? handleMonthBarClick : undefined}
                    >
                      {data.map((_, index) => (
                        <Cell key={`income-${index}`} fillOpacity={barOpacityForIndex(index)} />
                      ))}
                    </Bar>
                    {categories.map((c) => (
                      <Bar
                        key={c.key}
                        dataKey={c.key}
                        name={c.name}
                        stackId="spending"
                        fill={c.color}
                        radius={[0, 0, 0, 0]}
                        cursor={onMonthClick ? "pointer" : "default"}
                        onClick={onMonthClick ? handleMonthBarClick : undefined}
                      >
                        {data.map((_, index) => (
                          <Cell key={`${c.key}-${index}`} fillOpacity={barOpacityForIndex(index)} />
                        ))}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
