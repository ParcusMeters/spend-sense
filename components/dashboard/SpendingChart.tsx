"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface SpendingChartProps {
  data: {
    name: string;
    value: number;
    color: string;
  }[];
}

export function SpendingChart({ data }: SpendingChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const hasData = data.length > 0 && total > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spending by Category</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center text-center">
            <p className="text-sm text-muted-foreground">
              No spending categories for this month.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              This can happen when all debit transactions are categorized as{" "}
              <span className="font-medium text-foreground">Transfers</span> (or there are no debits).
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 lg:flex-row">
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
                  <Tooltip
                    formatter={(value) => [
                      `$${(Number(value) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`,
                      "",
                    ]}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
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
