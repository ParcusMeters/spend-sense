"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  XAxis,
} from "recharts";

interface DailyCategory {
  key: string;
  name: string;
  color: string;
}

interface DailySpendingCategoryChartProps {
  title?: string;
  data: Record<string, string | number>[];
  categories: DailyCategory[];
  /** Daily spending budget in cents — shown as a dashed reference line. */
  budgetCents?: number;
  /** Receives the bucket's range; for daily bars both dates are the same day. */
  onRangeClick?: (fromIso: string, toIso: string) => void;
  /** What one bar represents, used for the click hint. */
  bucketNoun?: "day" | "week";
}

interface DailyTooltipEntry {
  name?: string | number;
  value?: string | number | null;
  color?: string;
}

interface DailyTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: DailyTooltipEntry[];
}

function DailyTooltip({ active, label, payload }: DailyTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const nonZero = payload.filter((p) => Number(p.value ?? 0) > 0);
  if (nonZero.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card p-2 text-xs shadow-sm">
      <p className="mb-1 font-medium">{String(label)}</p>
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
              ${(Number(p.value) / 100).toLocaleString("en-AU", {
                minimumFractionDigits: 2,
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DailySpendingCategoryChart({
  title = "Daily Spending by Category",
  data,
  categories,
  budgetCents,
  onRangeClick,
  bucketNoun = "day",
}: DailySpendingCategoryChartProps) {
  const hasData = data.length > 0;
  const chartWidth = Math.max(760, data.length * 56);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const chartHeight = 320;

  const maxDailyCents = data.reduce((max, row) => {
    const total = categories.reduce(
      (sum, c) => sum + Number(row[c.key] ?? 0),
      0
    );
    return Math.max(max, total);
  }, 0);
  const dailyCeil = Math.max(maxDailyCents, budgetCents ?? 0);
  const niceMaxCents = dailyCeil > 0 ? Math.ceil(dailyCeil / 5000) * 5000 : 10000;
  const yTicks = Array.from({ length: 5 }, (_, i) =>
    Math.round(niceMaxCents - (niceMaxCents * i) / 4)
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !hasData) return;
    // Default view should show latest days on the right.
    el.scrollLeft = el.scrollWidth;
  }, [hasData, data.length, categories.length, title]);

  function handleDayBarClick(barEntry: unknown, rectIndex: number) {
    if (!onRangeClick) return;
    const isIso = (v: unknown): v is string =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

    const be = barEntry as {
      payload?: { date?: unknown; rangeEnd?: unknown };
      originalDataIndex?: number;
    };

    if (isIso(be?.payload?.date)) {
      const from = be.payload.date;
      onRangeClick(from, isIso(be.payload.rangeEnd) ? be.payload.rangeEnd : from);
      return;
    }

    const idx =
      typeof be?.originalDataIndex === "number" ? be.originalDataIndex : rectIndex;
    const row = data[idx];
    if (isIso(row?.date)) {
      onRangeClick(row.date, isIso(row.rangeEnd) ? row.rangeEnd : row.date);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {onRangeClick && (
          <p className="text-xs font-normal text-muted-foreground">
            Click a {bucketNoun} to open transactions filtered to it.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No daily spending data to display yet.
          </p>
        ) : categories.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No debit spending in this period.
          </p>
        ) : (
          <div className="flex gap-2">
            <div className="w-16 shrink-0 border-r pr-2">
              <div className="relative" style={{ height: chartHeight }}>
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

            <div ref={scrollRef} className="overflow-x-auto">
              <BarChart
                width={chartWidth}
                height={chartHeight}
                data={data}
                margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="label"
                  className="text-xs"
                  tick={{ fill: "var(--muted-foreground)" }}
                />
                <Tooltip content={<DailyTooltip />} />
                {budgetCents && budgetCents > 0 && (
                  <ReferenceLine
                    y={budgetCents}
                    stroke="hsl(0, 72%, 51%)"
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    label={{
                      value: `Budget $${Math.round(budgetCents / 100)}`,
                      position: "right",
                      fill: "hsl(0, 72%, 51%)",
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  />
                )}
                {categories.map((c) => (
                  <Bar
                    key={c.key}
                    dataKey={c.key}
                    name={c.name}
                    stackId="spend"
                    fill={c.color}
                    cursor={onRangeClick ? "pointer" : "default"}
                    onClick={onRangeClick ? handleDayBarClick : undefined}
                  />
                ))}
              </BarChart>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

