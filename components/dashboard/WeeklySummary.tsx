import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { formatCurrency } from "@/lib/utils/currency";
import { format, parseISO } from "date-fns";
import type { WeeklySummary as WeeklySummaryData } from "@/lib/dashboard/weekly-summary";

interface WeeklySummaryProps {
  summary: WeeklySummaryData;
}

function shortDate(iso: string): string {
  return format(parseISO(iso), "d MMM");
}

export function WeeklySummary({ summary }: WeeklySummaryProps) {
  const {
    start,
    end,
    totalCents,
    previousTotalCents,
    transactionCount,
    categories,
    merchants,
    largest,
    noSpendDays,
  } = summary;

  const deltaCents = totalCents - previousTotalCents;
  const deltaPct =
    previousTotalCents > 0 ? Math.round((deltaCents / previousTotalCents) * 100) : null;

  // Spending less than last week is the good direction, so down is green.
  const DeltaIcon = deltaCents > 0 ? TrendingUp : deltaCents < 0 ? TrendingDown : Minus;
  const deltaClass =
    deltaCents > 0
      ? "text-red-600 dark:text-red-400"
      : deltaCents < 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";

  const topCategories = categories.slice(0, 5);
  const topMerchants = merchants.slice(0, 5);

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Last 7 Days</CardTitle>
          <span className="text-xs text-muted-foreground">
            {shortDate(start)} – {shortDate(end)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <p className="text-3xl font-bold">{formatCurrency(totalCents)}</p>
          <span className={`flex items-center gap-1 text-sm font-medium ${deltaClass}`}>
            <DeltaIcon className="h-4 w-4" />
            {deltaCents === 0
              ? "same as last week"
              : `${formatCurrency(Math.abs(deltaCents))}${
                  deltaPct === null ? "" : ` (${Math.abs(deltaPct)}%)`
                } ${deltaCents > 0 ? "more" : "less"} than last week`}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          {transactionCount} {transactionCount === 1 ? "purchase" : "purchases"}
          {noSpendDays > 0
            ? ` · ${noSpendDays} no-spend ${noSpendDays === 1 ? "day" : "days"}`
            : ""}
          {" · transfers excluded"}
        </p>

        {totalCents === 0 ? (
          <p className="text-sm text-muted-foreground">
            No spending recorded in this window.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Where it went</p>
              {topCategories.map((c) => (
                <div key={c.name} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="ml-3 shrink-0 font-medium">
                      {formatCurrency(c.value)}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {Math.round(c.share * 100)}%
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(c.share * 100, 1)}%`,
                        backgroundColor: c.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {topMerchants.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Top merchants</p>
                {topMerchants.map((m) => (
                  <div
                    key={m.name}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate">
                      {m.name}
                      {m.count > 1 && (
                        <span className="ml-2 text-xs text-muted-foreground">×{m.count}</span>
                      )}
                    </span>
                    <span className="shrink-0 font-medium">{formatCurrency(m.value)}</span>
                  </div>
                ))}
              </div>
            )}

            {largest && (
              <p className="border-t pt-3 text-xs text-muted-foreground">
                Biggest single purchase:{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(largest.amountCents)}
                </span>{" "}
                at <span className="text-foreground">{largest.description}</span> (
                {largest.category}, {shortDate(largest.date)})
              </p>
            )}
          </>
        )}

        <Link
          href={`/transactions?from=${start}&to=${end}`}
          className="inline-block text-xs font-medium text-primary hover:underline"
        >
          View these transactions →
        </Link>
      </CardContent>
    </Card>
  );
}
