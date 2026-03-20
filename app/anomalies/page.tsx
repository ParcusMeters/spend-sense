export const dynamic = "force-dynamic";

import { createServiceClient } from "@/lib/supabase/server";
import { AuthGate } from "@/components/auth/AuthGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils/dates";
import { formatCurrency } from "@/lib/utils/currency";
import { AnomalyBadge } from "@/components/transactions/AnomalyBadge";

function getEffectiveCategory(t: {
  user_category_override: string | null;
  ai_category: string | null;
  redbark_category: string | null;
}) {
  return t.user_category_override ?? t.ai_category ?? t.redbark_category ?? "Other";
}

async function AnomaliesContent() {
  const supabase = createServiceClient();

  const { data: anomalyRows, error: anomaliesError } = await supabase
    .from("anomalies")
    .select(
      "id, transaction_id, type, description, severity, is_resolved, resolved_at, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (anomaliesError || !anomalyRows) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Anomalies</h1>
        <p className="text-muted-foreground">Failed to load anomalies.</p>
      </div>
    );
  }

  const transactionIds = anomalyRows.map((a) => a.transaction_id);
  const { data: txns } = await supabase
    .from("transactions")
    .select(
      "id, date, description, merchant, amount_cents, direction, ai_category, user_category_override, redbark_category"
    )
    .in("id", transactionIds);

  const txnById = new Map<string, (typeof txns)[number]>();
  for (const t of txns ?? []) txnById.set(t.id, t);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Anomalies</h1>
        <p className="text-muted-foreground">
          Transactions flagged by AI heuristics for review.
        </p>
      </div>

      {anomalyRows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No anomalies detected yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {anomalyRows.map((a) => {
            const t = txnById.get(a.transaction_id);
            const merchant = t?.merchant ?? t?.description ?? "Unknown";
            const amount = t ? formatCurrency(Math.abs(t.amount_cents)) : "";
            const category = t
              ? getEffectiveCategory(t)
              : "Other";
            const prefix = t?.direction === "credit" ? "+" : "-";

            return (
              <Card key={a.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">
                        {merchant}
                      </CardTitle>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {t?.date && (
                          <span className="text-xs text-muted-foreground">
                            {formatDate(t.date)}
                          </span>
                        )}
                        <Badge variant="secondary" className="text-xs">
                          {category}
                        </Badge>
                        <AnomalyBadge type={a.type} severity={a.severity} />
                        {a.is_resolved && (
                          <Badge variant="outline" className="text-xs">
                            Resolved
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 text-sm font-semibold">
                      {t ? (
                        <>
                          {prefix}
                          {amount}
                        </>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground">
                    {a.description}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AnomaliesPage() {
  return (
    <AuthGate>
      <AnomaliesContent />
    </AuthGate>
  );
}

