"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/dates";
import { Button } from "@/components/ui/button";

export interface RecurringSeries {
  id: string;
  name: string;
  category: string;
  accountName: string | null;
  accountId: string;
  merchant: string | null;
  lastChargeDate: string;
  lastAmountCents: number;
}

interface RecurringPaymentsProps {
  series: RecurringSeries[];
}

export function RecurringPayments({ series }: RecurringPaymentsProps) {
  const [items, setItems] = useState(series);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function markNotRecurring(s: RecurringSeries) {
    setUpdatingId(s.id);
    try {
      const res = await fetch("/api/recurring/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: s.accountId,
          merchant: s.merchant,
          description: s.merchant ? null : s.name,
          is_recurring: false,
        }),
      });

      if (res.ok) {
        setItems((prev) => prev.filter((p) => p.id !== s.id));
      }
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recurring Payments</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No recurring payments detected yet.
          </p>
        ) : (
          <div className="space-y-3">
            {items.map((s) => (
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
                <div className="flex items-center gap-3">
                  <span className="shrink-0 text-sm font-semibold">
                    {formatCurrency(Math.abs(s.lastAmountCents))}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => markNotRecurring(s)}
                    disabled={updatingId === s.id}
                  >
                    {updatingId === s.id ? "Updating..." : "Not recurring"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

