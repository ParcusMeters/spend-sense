"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/dates";
import { AlertTriangle } from "lucide-react";

interface RecentTransaction {
  id: string;
  date: string;
  description: string;
  amount_cents: number;
  direction: "debit" | "credit";
  merchant: string | null;
  ai_category: string | null;
  user_category_override: string | null;
  redbark_category: string | null;
  is_anomaly: boolean;
  anomaly_reason: string | null;
}

interface RecentTransactionsProps {
  transactions: RecentTransaction[];
}

function getEffectiveCategory(t: RecentTransaction): string {
  return t.user_category_override ?? t.redbark_category ?? "Other";
}

export function RecentTransactions({ transactions }: RecentTransactionsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Transactions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {transactions.map((txn) => (
            <div
              key={txn.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">
                      {txn.merchant ?? txn.description}
                    </p>
                    {txn.is_anomaly && (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(txn.date)}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {getEffectiveCategory(txn)}
                    </Badge>
                  </div>
                </div>
              </div>
              <span
                className={`shrink-0 text-sm font-semibold ${
                  txn.direction === "credit"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-foreground"
                }`}
              >
                {txn.direction === "credit" ? "+" : "-"}
                {formatCurrency(Math.abs(txn.amount_cents))}
              </span>
            </div>
          ))}
          {transactions.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              No transactions yet. Connect your bank via Redbark to get started.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
