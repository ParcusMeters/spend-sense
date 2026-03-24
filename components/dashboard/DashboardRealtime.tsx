"use client";

import { useEffect, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils/currency";
import { useRouter } from "next/navigation";

/** Coalesce many INSERTs (e.g. webhook bulk sync) into one RSC refresh. */
const REFRESH_DEBOUNCE_MS = 1200;

export function DashboardRealtime() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };

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

          scheduleRefresh();
        }
      )
      .subscribe();

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [supabase, router]);

  return null;
}
