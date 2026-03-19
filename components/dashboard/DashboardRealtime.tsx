"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils/currency";
import { useRouter } from "next/navigation";

export function DashboardRealtime() {
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    const channel = supabase
      .channel("transactions-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "transactions" },
        (payload) => {
          const txn = payload.new as {
            merchant: string | null;
            description: string;
            amount_cents: number;
            direction: string;
            is_anomaly: boolean;
          };

          const name = txn.merchant ?? txn.description;
          const amount = formatCurrency(Math.abs(txn.amount_cents));
          const prefix = txn.direction === "credit" ? "+" : "-";

          if (txn.is_anomaly) {
            toast.warning(`Flagged: ${name}`, {
              description: `${prefix}${amount} — This transaction was flagged for review`,
            });
          } else {
            toast(`New transaction: ${name}`, {
              description: `${prefix}${amount}`,
            });
          }

          router.refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, router]);

  return null;
}
