-- Stable Redbark REST account id (from GET /v1/accounts) for balance sync and webhook linking
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS redbark_account_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_accounts_redbark_account_id
  ON accounts (redbark_account_id)
  WHERE redbark_account_id IS NOT NULL;
