export const dynamic = "force-dynamic";

import { TransactionList } from "@/components/transactions/TransactionList";

export default function TransactionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Transactions</h1>
        <p className="text-muted-foreground">
          View and manage all your bank transactions
        </p>
      </div>
      <TransactionList />
    </div>
  );
}
