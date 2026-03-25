"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface SavingsProjectionProps {
  data: {
    month: string;
    projected: number;
    actual?: number;
  }[];
  savingsGoal: number;
}

export function SavingsProjection({ data, savingsGoal }: SavingsProjectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Savings Projection (12 Months)</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Recharts renders SVG text; scope muted fill so ticks/labels match Income vs Spending charts. */}
        <div
          className="h-[300px] [&_.recharts-cartesian-axis-tick-value]:!fill-[var(--muted-foreground)] [&_.recharts-label]:!fill-[var(--muted-foreground)] [&_.recharts-text]:!fill-[var(--muted-foreground)]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="month"
                className="text-xs"
                stroke="var(--muted-foreground)"
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                label={{
                  value: "Month",
                  position: "insideBottom",
                  offset: -4,
                  fill: "var(--muted-foreground)",
                  fontSize: 12,
                  fontWeight: 500,
                  style: { fill: "var(--muted-foreground)" },
                }}
              />
              <YAxis
                className="text-xs"
                stroke="var(--muted-foreground)"
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                label={{
                  value: "Projected balance",
                  angle: -90,
                  position: "insideLeft",
                  fill: "var(--muted-foreground)",
                  fontSize: 12,
                  fontWeight: 500,
                  style: { fill: "var(--muted-foreground)" },
                }}
              />
              <Tooltip
                formatter={(value) => [
                  `$${Number(value).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`,
                  "",
                ]}
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              {savingsGoal > 0 && (
                <ReferenceLine
                  y={savingsGoal}
                  stroke="hsl(152, 69%, 31%)"
                  strokeDasharray="5 5"
                  label={{
                    value: `Goal: $${savingsGoal.toLocaleString()}`,
                    fill: "var(--muted-foreground)",
                    fontSize: 12,
                  }}
                />
              )}
              {data.some((d) => d.actual !== undefined) && (
                <Line
                  type="monotone"
                  dataKey="actual"
                  stroke="hsl(152, 69%, 31%)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  name="Actual"
                />
              )}
              <Line
                type="monotone"
                dataKey="projected"
                stroke="hsl(217, 91%, 60%)"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                name="Projected"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
