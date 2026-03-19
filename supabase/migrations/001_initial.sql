-- Accounts (synced from Redbark webhook data)
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    redbark_name TEXT UNIQUE NOT NULL,
    institution TEXT NOT NULL,
    type TEXT NOT NULL,
    balance DECIMAL(12,2) DEFAULT 0,
    currency TEXT DEFAULT 'AUD',
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Categories
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    icon TEXT,
    color TEXT,
    budget_limit DECIMAL(12,2),
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default categories
INSERT INTO categories (name, icon, color, is_system) VALUES
    ('Salary', '💰', '#1D9E75', TRUE),
    ('Groceries', '🛒', '#5DCAA5', TRUE),
    ('Eating out', '🍽️', '#ED93B1', TRUE),
    ('Drinks & nightlife', '🍺', '#D4537E', TRUE),
    ('Transport', '🚗', '#F0997B', TRUE),
    ('Subscriptions', '📱', '#378ADD', TRUE),
    ('Entertainment', '🎮', '#FAC775', TRUE),
    ('Health', '🏥', '#AFA9EC', TRUE),
    ('Shopping', '🛍️', '#534AB7', TRUE),
    ('Travel', '✈️', '#5DCAA5', TRUE),
    ('Bank fees', '🏦', '#B4B2A9', TRUE),
    ('Transfers', '↔️', '#888780', TRUE),
    ('Investing', '📈', '#1D9E75', TRUE),
    ('Other', '📦', '#B4B2A9', TRUE);

-- Transactions
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    redbark_id TEXT UNIQUE NOT NULL,
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id),
    date DATE NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT DEFAULT 'aud',
    direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
    status TEXT DEFAULT 'posted',
    merchant TEXT,
    redbark_class TEXT,
    redbark_category TEXT,
    ai_category TEXT,
    ai_confidence DECIMAL(3,2),
    user_category_override TEXT,
    is_recurring BOOLEAN DEFAULT FALSE,
    is_anomaly BOOLEAN DEFAULT FALSE,
    anomaly_reason TEXT,
    post_date DATE,
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_date ON transactions(date DESC);
CREATE INDEX idx_transactions_account ON transactions(account_id);
CREATE INDEX idx_transactions_redbark_id ON transactions(redbark_id);
CREATE INDEX idx_transactions_direction ON transactions(direction);

-- AI Insights
CREATE TABLE insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL CHECK (type IN ('weekly', 'monthly', 'ad_hoc')),
    period_start DATE,
    period_end DATE,
    content TEXT NOT NULL,
    summary TEXT,
    data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Savings Goals
CREATE TABLE goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    target_amount DECIMAL(12,2) NOT NULL,
    current_amount DECIMAL(12,2) DEFAULT 0,
    deadline DATE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Anomalies
CREATE TABLE anomalies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('duplicate', 'unusual_amount', 'unusual_merchant', 'unusual_time', 'subscription_change')),
    description TEXT NOT NULL,
    severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
    is_resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Monthly summaries (precomputed for fast dashboard)
CREATE TABLE monthly_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    month DATE NOT NULL UNIQUE,
    total_income DECIMAL(12,2) DEFAULT 0,
    total_spending DECIMAL(12,2) DEFAULT 0,
    total_saved DECIMAL(12,2) DEFAULT 0,
    savings_rate DECIMAL(5,4) DEFAULT 0,
    category_breakdown JSONB,
    transaction_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Supabase Realtime for live dashboard updates
ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE anomalies;

-- RLS (single user app, allow all for authenticated)
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all" ON accounts FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON transactions FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON insights FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON goals FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON anomalies FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON monthly_summaries FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON categories FOR ALL USING (auth.role() = 'authenticated');

-- Seed initial savings goal
INSERT INTO goals (name, target_amount, current_amount) VALUES ('Savings Goal', 20000, 4100);
