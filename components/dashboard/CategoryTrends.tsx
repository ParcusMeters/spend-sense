import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { formatCurrency } from "@/lib/utils/currency";
import type { CategoryTrend, CategoryTrendsResult } from "@/lib/dashboard/category-trends";

interface CategoryTrendsProps {
  result: CategoryTrendsResult;
}

const SPARK_W = 104;
const SPARK_H = 30;

/** Bar sparkline: discrete months read better as bars than as a continuous line. */
function Sparkline({ trend }: { trend: CategoryTrend }) {
  const { points, peak, color } = trend;
  if (points.length === 0) return null;

  const gap = 2;
  const barW = (SPARK_W - gap * (points.length - 1)) / points.length;

  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      role="img"
      aria-label={points.map((p) => `${p.label} ${Math.round(p.total / 100)}`).join(", ")}
      className="overflow-visible"
    >
      {points.map((p, i) => {
        const h = peak > 0 ? Math.max((p.total / peak) * SPARK_H, p.total > 0 ? 1.5 : 0) : 0;
        const isLatest = i === points.length - 1;
        return (
          <rect
            key={p.key}
            x={i * (barW + gap)}
            y={SPARK_H - h}
            width={barW}
            height={h}
            rx={1}
            fill={color}
            // The month being compared is the solid one; history sits behind it.
            opacity={isLatest ? 1 : 0.35}
          />
        );
      })}
    </svg>
  );
}

export function CategoryTrends({ result }: CategoryTrendsProps) {
  const { trends, latestMonthLabel, monthsCompared, daysIntoCurrentMonth } = result;

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Category trends</CardTitle>
          <span className="text-xs text-muted-foreground">
            {latestMonthLabel} vs previous {monthsCompared - 1} months
          </span>
        </div>
        <p className="text-xs font-normal text-muted-foreground">
          Complete months only — the current month is {daysIntoCurrentMonth}{" "}
          {daysIntoCurrentMonth === 1 ? "day" : "days"} old and shown separately.
        </p>
      </CardHeader>

      <CardContent>
        {trends.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Not enough history yet to show trends.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
            {trends.map((trend) => {
              const { delta, deltaPct } = trend;
              const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus;
              const tone =
                delta > 0
                  ? "text-red-600 dark:text-red-400"
                  : delta < 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground";

              return (
                <div key={trend.name} className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: trend.color }}
                    />
                    <span className="truncate text-sm font-medium">{trend.name}</span>
                  </div>

                  <div className="flex items-end justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-lg font-semibold leading-tight">
                        {formatCurrency(trend.latest)}
                      </p>
                      <p className={`flex items-center gap-0.5 text-xs ${tone}`}>
                        <Icon className="h-3 w-3 shrink-0" />
                        {deltaPct === null
                          ? "no prior months"
                          : `${Math.abs(deltaPct)}% vs avg ${formatCurrency(trend.average)}`}
                      </p>
                    </div>
                    <Sparkline trend={trend} />
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(trend.monthToDate)} so far this month
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
