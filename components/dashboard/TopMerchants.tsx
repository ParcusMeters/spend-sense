import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDown, ArrowUp } from "lucide-react";
import { formatCurrency } from "@/lib/utils/currency";
import type { MerchantLeaderboard } from "@/lib/dashboard/merchant-summary";

interface TopMerchantsProps {
  leaderboard: MerchantLeaderboard;
}

export function TopMerchants({ leaderboard }: TopMerchantsProps) {
  const { rows, windowTotal, days, start, end } = leaderboard;
  const max = rows[0]?.total ?? 0;

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Where your money goes</CardTitle>
          <span className="text-xs text-muted-foreground">Last {days} days</span>
        </div>
        <p className="text-xs font-normal text-muted-foreground">
          Top merchants by spend, compared with the previous {days} days.
        </p>
      </CardHeader>

      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No merchant spending in this window.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const delta = row.total - row.previousTotal;
              // A merchant with no history is new rather than "up 100%".
              const isNew = row.previousTotal === 0;
              const deltaPct = isNew
                ? null
                : Math.round((delta / row.previousTotal) * 100);
              const share = windowTotal > 0 ? (row.total / windowTotal) * 100 : 0;

              return (
                <div key={row.name} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 translate-y-[1px] rounded-full"
                        style={{ backgroundColor: row.color }}
                        title={row.category}
                      />
                      <span className="truncate text-sm font-medium">{row.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        ×{row.count}
                      </span>
                    </span>

                    <span className="flex shrink-0 items-baseline gap-2">
                      <span className="text-sm font-medium">{formatCurrency(row.total)}</span>
                      {isNew ? (
                        <span className="text-xs text-muted-foreground">new</span>
                      ) : delta === 0 ? (
                        <span className="text-xs text-muted-foreground">level</span>
                      ) : (
                        <span
                          className={`flex items-center text-xs ${
                            delta > 0
                              ? "text-red-600 dark:text-red-400"
                              : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {delta > 0 ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )}
                          {deltaPct === null ? "" : `${Math.abs(deltaPct)}%`}
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${max > 0 ? Math.max((row.total / max) * 100, 1) : 0}%`,
                          backgroundColor: row.color,
                        }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                      {share.toFixed(0)}% · {formatCurrency(row.average)} avg
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Link
          href={`/transactions?from=${start}&to=${end}`}
          className="mt-4 inline-block text-xs font-medium text-primary hover:underline"
        >
          View all transactions in this window →
        </Link>
      </CardContent>
    </Card>
  );
}
