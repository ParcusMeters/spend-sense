-- Spending budgets (single-row table for weekly spending goal)
CREATE TABLE spending_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    weekly_limit_cents INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE spending_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all" ON spending_budgets FOR ALL USING (auth.role() = 'authenticated');
