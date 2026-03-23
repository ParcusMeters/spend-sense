"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface MonthlyTrendProps {
  data: Record<string, string | number>[];
  categories: {
    key: string;
    name: string;
    color: string;
  }[];
}

interface TrendTooltipEntry {
  name?: string | number;
  value?: string | number | null;
  color?: string;
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

export function MonthlyTrend({ data, categories }: MonthlyTrendProps) {
  const hasData = data.length > 0;
  const chartWidth = Math.max(760, data.length * 88);
  const chartHeight = 300;
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !hasData) return;
    el.scrollLeft = el.scrollWidth;
  }, [hasData, data.length, categories.length]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Income vs Spending</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No monthly trend data yet.
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
                barGap={4}
                margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="month"
                  className="text-xs"
                  tick={{ fill: "#ffffff" }}
                />
                <Tooltip content={<MonthlyTrendTooltip />} />
                <Bar
                  dataKey="income"
                  name="Income"
                  fill="hsl(152, 69%, 31%)"
                  radius={[4, 4, 0, 0]}
                />
                {categories.map((c) => (
                  <Bar
                    key={c.key}
                    dataKey={c.key}
                    name={c.name}
                    stackId="spending"
                    fill={c.color}
                    radius={[0, 0, 0, 0]}
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
