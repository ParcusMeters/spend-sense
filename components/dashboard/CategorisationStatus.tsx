"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Progress } from "@/components/ui/progress";

type Status = {
  pending: number;
  processing: number;
  failed: number;
  done: number;
  remaining: number;
  total: number;
};

/** Coalesce the burst of row updates a categorisation run produces. */
const REFETCH_DEBOUNCE_MS = 700;
/** Safety net in case a realtime event is missed while a run is in flight. */
const ACTIVE_POLL_MS = 4000;
/** How long the "all caught up" confirmation stays on screen. */
const DONE_VISIBLE_MS = 6000;

export function CategorisationStatus() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [status, setStatus] = useState<Status | null>(null);
  const [justFinished, setJustFinished] = useState(false);

  // Remaining count when this run started, so progress is measured against it.
  // Held in state rather than a ref because the render path reads it.
  const [runBaseline, setRunBaseline] = useState<number | null>(null);
  const wasActiveRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/categorise/status", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as Status;
      setStatus(next);

      const active = next.pending + next.processing > 0;

      if (active) {
        // Functional update: the baseline only grows, and this avoids capturing a
        // stale value in the callback.
        setRunBaseline((prev) =>
          prev === null || next.remaining > prev ? next.remaining : prev
        );
        setJustFinished(false);
        if (doneTimerRef.current) {
          clearTimeout(doneTimerRef.current);
          doneTimerRef.current = null;
        }
      } else if (wasActiveRef.current) {
        // Finished: pull the newly written categories into the dashboard once,
        // rather than refreshing on every row update.
        setRunBaseline(null);
        setJustFinished(true);
        router.refresh();
        toast.success("Categorisation complete", {
          description:
            next.failed > 0
              ? `${next.failed} transaction${next.failed === 1 ? "" : "s"} failed and will retry.`
              : "All transactions are categorised.",
        });
        doneTimerRef.current = setTimeout(() => setJustFinished(false), DONE_VISIBLE_MS);
      }

      wasActiveRef.current = active;
    } catch {
      // Transient failures are not worth surfacing; the next tick retries.
    }
  }, [router]);

  const scheduleFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void fetchStatus();
    }, REFETCH_DEBOUNCE_MS);
  }, [fetchStatus]);

  useEffect(() => {
    // fetchStatus only setStates after awaiting the request, so this cannot cause
    // the synchronous cascade the rule guards against — it is the initial read of
    // an external system, same as the subscription below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchStatus();

    const channel = supabase
      .channel("categorisation-status")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "transactions" },
        () => scheduleFetch()
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [supabase, fetchStatus, scheduleFetch]);

  // While a run is active, poll as a backstop against dropped realtime events.
  const isActive = Boolean(status && status.pending + status.processing > 0);
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => void fetchStatus(), ACTIVE_POLL_MS);
    return () => clearInterval(id);
  }, [isActive, fetchStatus]);

  if (!status) return null;

  if (isActive) {
    const baseline = runBaseline ?? status.remaining;
    const completed = Math.max(baseline - status.remaining, 0);
    const percent = baseline > 0 ? Math.min((completed / baseline) * 100, 100) : 0;

    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Categorising transactions…
          </span>
          <span className="text-xs text-muted-foreground">
            {completed} of {baseline} done
            {status.processing > 0 && ` · ${status.processing} in flight`}
          </span>
        </div>
        <Progress value={percent} className="mt-3 h-1.5" />
        <p className="mt-2 text-xs text-muted-foreground">
          {status.pending} waiting · updates live as each batch finishes
        </p>
      </div>
    );
  }

  if (justFinished) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card p-4 text-sm">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <span className="font-medium">Categorisation complete</span>
        <span className="text-muted-foreground">
          {status.done} categorised
          {status.failed > 0 && ` · ${status.failed} failed`}
        </span>
      </div>
    );
  }

  if (status.failed > 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card p-4 text-sm">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="font-medium">
          {status.failed} transaction{status.failed === 1 ? "" : "s"} failed to categorise
        </span>
        <span className="text-muted-foreground">Retried on the next run.</span>
      </div>
    );
  }

  return null;
}
