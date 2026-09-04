"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface SpendingChartProps {
  data: {
    name: string;
    value: number;
    color: string;
  }[];
  title?: string;
  emptyLabel?: string;
  /**
   * "stack" keeps the legend under the wheel, for when this sits in a narrow
   * column — the default side-by-side layout keys off viewport width, which says
   * nothing about how much room the card itself has.
   */
  layout?: "auto" | "stack";
}

interface PieTooltipEntry {
  name?: string | number;
  value?: string | number | null;
  color?: string;
}

interface PieTooltipProps {
  active?: boolean;
  payload?: PieTooltipEntry[];
}

function SpendingPieTooltip({ active, payload }: PieTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const first = payload[0];
  if (!first || Number(first.value ?? 0) <= 0) return null;

  return (
    <div className="rounded-lg border bg-card p-2 text-xs shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: first.color ?? "currentColor" }}
          />
          {String(first.name ?? "")}
        </span>
        <span className="font-medium">
          ${(Number(first.value) / 100).toLocaleString("en-AU", {
            minimumFractionDigits: 2,
          })}
        </span>
      </div>
    </div>
  );
}

export function SpendingChart({
  data,
  title = "Spending by Category (Last 6 Months)",
  emptyLabel = "the last 6 months",
  layout = "auto",
}: SpendingChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const hasData = data.length > 0 && total > 0;

  return (
    <Card className="w-full min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center text-center">
            <p className="text-sm text-muted-foreground">
              No spending categories for {emptyLabel}.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              This can happen when all debit transactions are categorized as{" "}
              <span className="font-medium text-foreground">Transfers</span> (or there are no debits).
            </p>
          </div>
        ) : (
          <div
            className={`flex flex-col items-center gap-4 ${
              layout === "auto" ? "lg:flex-row" : ""
            }`}
          >
            <div className="h-[220px] w-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {data.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<SpendingPieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-2">
              {data.slice(0, 6).map((item) => (
                <div key={item.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span>{item.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium">
                      ${(item.value / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-muted-foreground">
                      {total > 0 ? ((item.value / total) * 100).toFixed(0) : 0}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
