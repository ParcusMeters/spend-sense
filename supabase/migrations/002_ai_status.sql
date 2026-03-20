-- Add ai_status column for background processing queue
ALTER TABLE transactions ADD COLUMN ai_status TEXT DEFAULT 'pending' CHECK (ai_status IN ('pending', 'processing', 'done', 'failed'));

-- Index for efficient pickup of pending transactions
CREATE INDEX idx_transactions_ai_status ON transactions(ai_status) WHERE ai_status IN ('pending', 'failed');

-- Backfill: mark existing categorised transactions as done
UPDATE transactions SET ai_status = 'done' WHERE ai_category IS NOT NULL;
