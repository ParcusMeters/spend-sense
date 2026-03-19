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
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="month"
                className="text-xs"
                tick={{ fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                className="text-xs"
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
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
                    fill: "hsl(var(--muted-foreground))",
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
