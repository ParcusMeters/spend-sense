"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/dates";

export interface RecurringSeries {
  id: string;
  name: string;
  category: string;
  accountName: string | null;
  lastChargeDate: string;
  lastAmountCents: number;
}

interface RecurringPaymentsProps {
  series: RecurringSeries[];
}

export function RecurringPayments({ series }: RecurringPaymentsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recurring Payments</CardTitle>
      </CardHeader>
      <CardContent>
        {series.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No recurring payments detected yet.
          </p>
        ) : (
          <div className="space-y-3">
            {series.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <Badge variant="secondary" className="text-xs">
                      {s.category}
                    </Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Last charge: {formatDate(s.lastChargeDate)}</span>
                    {s.accountName && <span>· {s.accountName}</span>}
                  </div>
                </div>
                <span className="shrink-0 text-sm font-semibold">
                  {formatCurrency(Math.abs(s.lastAmountCents))}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

