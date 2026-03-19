import { createServiceClient } from "@/lib/supabase/server";

interface AnomalyResult {
  transaction_id: string;
  type: "duplicate" | "unusual_amount" | "subscription_change";
  description: string;
  severity: "low" | "medium" | "high";
}

export async function detectAnomalies(
  transactionId: string,
  merchant: string | null,
  amountCents: number,
  date: string,
  isRecurring: boolean
): Promise<AnomalyResult[]> {
  const supabase = createServiceClient();
  const anomalies: AnomalyResult[] = [];

  // 1. Duplicate detection: same merchant + same amount + same day
  if (merchant) {
    const { data: dupes } = await supabase
      .from("transactions")
      .select("id")
      .eq("merchant", merchant)
      .eq("amount_cents", amountCents)
      .eq("date", date)
      .neq("id", transactionId);

    if (dupes && dupes.length > 0) {
      anomalies.push({
        transaction_id: transactionId,
        type: "duplicate",
        description: `Possible duplicate: same merchant (${merchant}), amount ($${Math.abs(amountCents) / 100}), and date`,
        severity: "high",
      });
    }
  }

  // 2. Unusual amount: compare to average for this merchant
  if (merchant) {
    const { data: history } = await supabase
      .from("transactions")
      .select("amount_cents")
      .eq("merchant", merchant)
      .neq("id", transactionId)
      .order("date", { ascending: false })
      .limit(20);

    if (history && history.length >= 3) {
      const amounts = history.map((t) => Math.abs(t.amount_cents));
      const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const absAmount = Math.abs(amountCents);

      if (absAmount > avg * 2 && absAmount - avg > 2000) {
        anomalies.push({
          transaction_id: transactionId,
          type: "unusual_amount",
          description: `Unusual amount: $${(absAmount / 100).toFixed(2)} vs average $${(avg / 100).toFixed(2)} at ${merchant}`,
          severity: absAmount > avg * 3 ? "high" : "medium",
        });
      }
    }
  }

  // 3. Subscription change: recurring charge with different amount
  if (isRecurring && merchant) {
    const { data: previous } = await supabase
      .from("transactions")
      .select("amount_cents")
      .eq("merchant", merchant)
      .eq("is_recurring", true)
      .neq("id", transactionId)
      .order("date", { ascending: false })
      .limit(1);

    if (previous && previous.length > 0) {
      const prevAmount = previous[0].amount_cents;
      if (prevAmount !== amountCents) {
        anomalies.push({
          transaction_id: transactionId,
          type: "subscription_change",
          description: `Subscription price change at ${merchant}: was $${(Math.abs(prevAmount) / 100).toFixed(2)}, now $${(Math.abs(amountCents) / 100).toFixed(2)}`,
          severity: "medium",
        });
      }
    }
  }

  return anomalies;
}
