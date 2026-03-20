export interface Account {
  id: string;
  redbark_name: string;
  institution: string;
  type: string;
  balance: number;
  currency: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  budget_limit: number | null;
  is_system: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  redbark_id: string;
  account_id: string;
  category_id: string | null;
  date: string;
  description: string;
  amount_cents: number;
  currency: string;
  direction: "debit" | "credit";
  status: string;
  merchant: string | null;
  redbark_class: string | null;
  redbark_category: string | null;
  ai_category: string | null;
  ai_confidence: number | null;
  user_category_override: string | null;
  is_recurring: boolean;
  is_anomaly: boolean;
  anomaly_reason: string | null;
  ai_status: "pending" | "processing" | "done" | "failed";
  post_date: string | null;
  raw_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionWithAccount extends Transaction {
  accounts: Account;
  categories: Category | null;
}

export interface Insight {
  id: string;
  type: "weekly" | "monthly" | "ad_hoc";
  period_start: string | null;
  period_end: string | null;
  content: string;
  summary: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface Goal {
  id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  deadline: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Anomaly {
  id: string;
  transaction_id: string;
  type: "duplicate" | "unusual_amount" | "unusual_merchant" | "unusual_time" | "subscription_change";
  description: string;
  severity: "low" | "medium" | "high";
  is_resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

export interface MonthlySummary {
  id: string;
  month: string;
  total_income: number;
  total_spending: number;
  total_saved: number;
  savings_rate: number;
  category_breakdown: Record<string, number> | null;
  transaction_count: number;
  created_at: string;
  updated_at: string;
}
