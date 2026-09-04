import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Repeat, TrendingUp, TrendingDown, MoonStar } from "lucide-react";
import { formatCurrency } from "@/lib/utils/currency";
import { format, parseISO } from "date-fns";
import type { SubscriptionSummary } from "@/lib/dashboard/subscriptions";

interface SubscriptionsProps {
  summary: SubscriptionSummary;
  /** Rows shown before collapsing into a "+N more" line. */
  visible?: number;
}

export function Subscriptions({ summary, visible = 8 }: SubscriptionsProps) {
  const { rows, activeMonthlyEstimate, activeCount, dormantCount, windowDays } = summary;
  const shown = rows.slice(0, visible);
  const hidden = rows.length - shown.length;

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <div className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Recurring payments
            </CardTitle>
            <p className="mt-1 text-2xl font-bold">
              {formatCurrency(activeMonthlyEstimate)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">/mo</span>
            </p>
          </div>
          <div className="rounded-lg bg-purple-50 p-2 dark:bg-purple-950">
            <Repeat className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          </div>
        </div>
        <p className="text-xs font-normal text-muted-foreground">
          {activeCount} active{dormantCount > 0 && `, ${dormantCount} gone quiet`} · run-rate
          from the last {windowDays} days
        </p>
      </CardHeader>

      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No recurring payments detected yet.
          </p>
        ) : (
          <div className="space-y-2.5">
            {shown.map((row) => (
              <div key={row.name} className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 translate-y-[1px] rounded-full"
                    style={{ backgroundColor: row.color, opacity: row.dormant ? 0.4 : 1 }}
                  />
                  <span className="min-w-0">
                    <span
                      className={`block truncate text-sm ${
                        row.dormant ? "text-muted-foreground" : "font-medium"
                      }`}
                    >
                      {row.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {row.dormant ? (
                        <span className="inline-flex items-center gap-1">
                          <MoonStar className="h-3 w-3" />
                          nothing since {format(parseISO(row.lastDate), "d MMM")}
                        </span>
                      ) : (
                        <>
                          {row.cadenceLabel} · last {formatCurrency(row.lastAmount)}
                          {row.priceDelta !== 0 && row.previousAmount !== null && (
                            <span
                              className={`ml-1 inline-flex items-center gap-0.5 ${
                                row.priceDelta > 0
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-emerald-600 dark:text-emerald-400"
                              }`}
                            >
                              {row.priceDelta > 0 ? (
                                <TrendingUp className="h-3 w-3" />
                              ) : (
                                <TrendingDown className="h-3 w-3" />
                              )}
                              {formatCurrency(Math.abs(row.priceDelta))} vs previous
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  </span>
                </span>

                <span
                  className={`shrink-0 text-sm ${
                    row.dormant ? "text-muted-foreground" : "font-medium"
                  }`}
                >
                  {formatCurrency(row.monthlyEstimate)}
                  <span className="text-xs font-normal text-muted-foreground">/mo</span>
                </span>
              </div>
            ))}

            {hidden > 0 && (
              <p className="pt-1 text-xs text-muted-foreground">
                +{hidden} more recurring {hidden === 1 ? "payment" : "payments"}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
