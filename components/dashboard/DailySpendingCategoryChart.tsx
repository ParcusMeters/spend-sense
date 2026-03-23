"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
} from "recharts";

interface DailyCategory {
  key: string;
  name: string;
  color: string;
}

interface DailySpendingCategoryChartProps {
  data: Record<string, string | number>[];
  categories: DailyCategory[];
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
  data,
  categories,
}: DailySpendingCategoryChartProps) {
  const hasData = data.length > 0 && categories.length > 0;
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
  const niceMaxCents = maxDailyCents > 0 ? Math.ceil(maxDailyCents / 5000) * 5000 : 10000;
  const yTicks = Array.from({ length: 5 }, (_, i) =>
    Math.round(niceMaxCents - (niceMaxCents * i) / 4)
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !hasData) return;
    // Default view should show latest days on the right.
    el.scrollLeft = el.scrollWidth;
  }, [hasData, data.length, categories.length]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Spending by Category</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No daily spending data to display yet.
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
                {categories.map((c) => (
                  <Bar
                    key={c.key}
                    dataKey={c.key}
                    name={c.name}
                    stackId="spend"
                    fill={c.color}
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

