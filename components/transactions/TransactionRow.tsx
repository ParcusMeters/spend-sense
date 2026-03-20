"use client";

import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/dates";
import { Badge } from "@/components/ui/badge";
import { AnomalyBadge } from "./AnomalyBadge";
import { AlertTriangle } from "lucide-react";

interface TransactionRowProps {
  transaction: {
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
    is_recurring: boolean;
    accounts?: { redbark_name: string } | null;
  };
  onClick?: () => void;
}

export function TransactionRow({ transaction: t, onClick }: TransactionRowProps) {
  const category =
    t.user_category_override ?? t.ai_category ?? t.redbark_category ?? "Other";

  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50 cursor-pointer"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">
              {t.merchant ?? t.description}
            </p>
            {t.is_anomaly && (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            )}
            {t.is_recurring && (
              <Badge variant="outline" className="text-xs shrink-0">
                Recurring
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">{formatDate(t.date)}</span>
            {t.accounts?.redbark_name && (
              <span className="text-xs text-muted-foreground">
                {t.accounts.redbark_name}
              </span>
            )}
            <Badge variant="secondary" className="text-xs">
              {category}
            </Badge>
          </div>
        </div>
      </div>
      <span
        className={`shrink-0 text-sm font-semibold ml-3 ${
          t.direction === "credit"
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-foreground"
        }`}
      >
        {t.direction === "credit" ? "+" : "-"}
        {formatCurrency(Math.abs(t.amount_cents))}
      </span>
    </div>
  );
}
