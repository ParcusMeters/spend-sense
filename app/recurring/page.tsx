export const dynamic = "force-dynamic";

import { createServiceClient } from "@/lib/supabase/server";
import { AuthGate } from "@/components/auth/AuthGate";
import {
  RecurringPayments,
  RecurringSeries,
} from "@/components/recurring/RecurringPayments";

async function RecurringContent() {
  const supabase = createServiceClient();

  const { data: txns } = await supabase
    .from("transactions")
    .select(
      "id, date, description, amount_cents, direction, merchant, ai_category, user_category_override, redbark_category, is_recurring, accounts(redbark_name)"
    )
    .eq("is_recurring", true)
    .eq("direction", "debit")
    .order("date", { ascending: false });

  const seriesMap = new Map<string, RecurringSeries>();

  for (const t of txns ?? []) {
    const name = t.merchant ?? t.description;
    const category =
      t.user_category_override ?? t.ai_category ?? t.redbark_category ?? "Other";
    const accounts = (t as any).accounts as { redbark_name: string }[] | { redbark_name: string } | null | undefined;
    const accountName = Array.isArray(accounts)
      ? accounts[0]?.redbark_name ?? null
      : accounts?.redbark_name ?? null;
    const key = `${name}__${accountName ?? "no-account"}`;

    if (!seriesMap.has(key)) {
      seriesMap.set(key, {
        id: t.id,
        name,
        category,
        accountName,
        lastChargeDate: t.date,
        lastAmountCents: t.amount_cents,
      });
    }
  }

  const series = Array.from(seriesMap.values());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Recurring Payments</h1>
        <p className="text-muted-foreground">
          Subscriptions and other recurring charges detected from your
          transactions.
        </p>
      </div>
      <RecurringPayments series={series} />
    </div>
  );
}

export default function RecurringPage() {
  return (
    <AuthGate>
      <RecurringContent />
    </AuthGate>
  );
}

