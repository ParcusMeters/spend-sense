export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { TransactionList } from "@/components/transactions/TransactionList";
import { AuthGate } from "@/components/auth/AuthGate";

export default function TransactionsPage() {
  return (
    <AuthGate>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Transactions</h1>
          <p className="text-muted-foreground">
            View and manage all your bank transactions
          </p>
        </div>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          }
        >
          <TransactionList />
        </Suspense>
      </div>
    </AuthGate>
  );
}
