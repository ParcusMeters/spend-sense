"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

type RunResult = {
  status: "ok" | "partial";
  rounds: number;
  processed: number;
  failed: number;
  message?: string;
  error?: string;
};

export function RunCategoriseButton() {
  const [running, setRunning] = useState(false);
  const router = useRouter();

  const onRun = async () => {
    try {
      setRunning(true);
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        toast.error("You must be logged in to run categorisation.");
        return;
      }

      const response = await fetch("/api/categorise/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ maxRounds: 30 }),
      });

      const result = (await response.json()) as RunResult;
      if (!response.ok) {
        throw new Error(result.error || "Failed to run categorisation");
      }

      if (result.status === "partial") {
        toast.warning("Categorisation partially completed", {
          description: `Processed ${result.processed}, failed ${result.failed}. ${result.message ?? ""}`.trim(),
        });
      } else {
        toast.success("Categorisation completed", {
          description: `Processed ${result.processed}, failed ${result.failed} in ${result.rounds} rounds.`,
        });
      }

      router.refresh();
    } catch (error) {
      toast.error("Could not run categorisation", {
        description: String(error),
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Button onClick={onRun} disabled={running} size="sm">
      {running ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Running...
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
