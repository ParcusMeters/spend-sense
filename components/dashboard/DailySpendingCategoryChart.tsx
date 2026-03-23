"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
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

export function DailySpendingCategoryChart({
  data,
  categories,
}: DailySpendingCategoryChartProps) {
  const hasData = data.length > 0 && categories.length > 0;
  const chartWidth = Math.max(760, data.length * 56);

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
          <div className="overflow-x-auto">
            <BarChart
              width={chartWidth}
              height={320}
              data={data}
              margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="label"
                className="text-xs"
                tick={{ fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                className="text-xs"
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) => `$${(Number(v) / 100).toFixed(0)}`}
              />
              <Tooltip
                formatter={(value, name) => [
                  `$${(Number(value) / 100).toLocaleString("en-AU", {
                    minimumFractionDigits: 2,
                  })}`,
                  String(name),
                ]}
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Legend />
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
        )}
      </CardContent>
    </Card>
  );
}

