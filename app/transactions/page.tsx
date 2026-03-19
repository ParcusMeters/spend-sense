export const dynamic = "force-dynamic";

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
        <TransactionList />
      </div>
    </AuthGate>
  );
}
