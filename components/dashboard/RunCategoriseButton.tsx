"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

type RunResult = {
  status: "ok";
  processed: number;
  failed: number;
  remaining: number;
  hasMore: boolean;
  stoppedReason: "complete" | "deadline" | "limit";
  elapsedMs: number;
  message?: string;
  error?: string;
};

/**
 * Each request does a bounded slice of work, so the queue is drained across
 * several requests rather than one long one that would hit the function timeout.
 */
const MAX_REQUESTS = 40;

export function RunCategoriseButton() {
  const [running, setRunning] = useState(false);
  const [doneSoFar, setDoneSoFar] = useState(0);
  const router = useRouter();

  const onRun = async () => {
    setRunning(true);
    setDoneSoFar(0);

    let totalProcessed = 0;
    let totalFailed = 0;

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        toast.error("You must be logged in to run categorisation.");
        return;
      }

      for (let attempt = 0; attempt < MAX_REQUESTS; attempt++) {
        const response = await fetch("/api/categorise/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({}),
        });

        const result = (await response.json()) as RunResult;
        if (!response.ok) {
          throw new Error(result.error || "Failed to run categorisation");
        }

        totalProcessed += result.processed;
        totalFailed += result.failed;
        setDoneSoFar(totalProcessed);

        if (!result.hasMore) break;

        // No progress but work remains — stop rather than spin.
        if (result.processed === 0 && result.failed === 0) {
          toast.warning("Categorisation stalled", {
            description: `${result.remaining} transaction${
              result.remaining === 1 ? "" : "s"
            } could not be processed. Check the logs.`,
          });
          break;
        }
      }

      if (totalProcessed === 0 && totalFailed === 0) {
        toast("Nothing to categorise", {
          description: "All transactions are already categorised.",
        });
      } else if (totalFailed > 0) {
        toast.warning("Categorisation finished with errors", {
          description: `Categorised ${totalProcessed}, failed ${totalFailed}.`,
        });
      } else {
        toast.success("Categorisation complete", {
          description: `Categorised ${totalProcessed} transaction${
            totalProcessed === 1 ? "" : "s"
          }.`,
        });
      }

      router.refresh();
    } catch (error) {
      toast.error("Could not run categorisation", {
        description: String(error),
      });
    } finally {
      setRunning(false);
      setDoneSoFar(0);
    }
  };

  return (
    <Button onClick={onRun} disabled={running} size="sm">
      {running ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {doneSoFar > 0 ? `Categorising… ${doneSoFar} done` : "Categorising…"}
        </>
      ) : (
        <>
          <Sparkles className="mr-2 h-4 w-4" />
          Run categorisation
        </>
      )}
    </Button>
  );
}
