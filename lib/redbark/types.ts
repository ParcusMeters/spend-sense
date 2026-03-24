export interface RedbarkTransaction {
  id: string;
  object: "transaction";
  amount: number;
  currency: string;
  status: string;
  description: string;
  direction: "debit" | "credit";
  class: string;
  /** Stable account UUID from Redbark (preferred over `account` string). */
  account_id?: string;
  /** Human-readable account name (preferred over deprecated `account`). */
  account_name?: string;
  /** @deprecated Use `account_id` + `account_name`. */
  account: string;
  transaction_date: string;
  post_date: string | null;
  merchant_name: string | null;
  category: string | null;
  merchant_category_code: string | null;
}

export interface RedbarkUpdatedTransaction extends RedbarkTransaction {
  previous_attributes: Record<string, unknown>;
}

export interface RedbarkWebhookPayload {
  id: string;
  object: "event";
  type: "transactions.synced";
  api_version: string;
  created: number;
  data: {
    new: RedbarkTransaction[];
    updated: RedbarkUpdatedTransaction[];
  };
  metadata: {
    sync_run_id: string;
    new_count: number;
    updated_count: number;
    chunk: number;
    total_chunks: number;
  };
}
