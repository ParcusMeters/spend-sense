-- Multi-user support: add user_id to all tables and enforce per-user RLS

-- User profiles (auto-created on signup via trigger)
CREATE TABLE user_profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    monthly_income_cents INTEGER DEFAULT 0,
    savings_goal_cents INTEGER DEFAULT 0,
    redbark_webhook_secret TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own_profile" ON user_profiles FOR ALL USING (auth.uid() = user_id);

-- Trigger to auto-create profile on new auth user
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO user_profiles (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Add user_id to accounts
ALTER TABLE accounts ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop the global unique constraint on redbark_name and redbark_account_id,
-- replace with per-user unique composites
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_redbark_name_key;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_redbark_account_id_key;
CREATE UNIQUE INDEX accounts_redbark_name_user_id_key ON accounts (redbark_name, user_id);
CREATE UNIQUE INDEX accounts_redbark_account_id_user_id_key ON accounts (redbark_account_id, user_id) WHERE redbark_account_id IS NOT NULL;

-- Add user_id to transactions
ALTER TABLE transactions ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to insights
ALTER TABLE insights ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to goals
ALTER TABLE goals ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to monthly_summaries
ALTER TABLE monthly_summaries ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE monthly_summaries DROP CONSTRAINT IF EXISTS monthly_summaries_month_key;
CREATE UNIQUE INDEX monthly_summaries_month_user_id_key ON monthly_summaries (month, user_id);

-- Add user_id to spending_budgets
ALTER TABLE spending_budgets ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX spending_budgets_user_id_key ON spending_budgets (user_id);

-- Add user_id to anomalies (cascades via transaction_id, but explicit for RLS)
ALTER TABLE anomalies ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop old permissive RLS policies
DROP POLICY IF EXISTS "auth_all" ON accounts;
DROP POLICY IF EXISTS "auth_all" ON transactions;
DROP POLICY IF EXISTS "auth_all" ON insights;
DROP POLICY IF EXISTS "auth_all" ON goals;
DROP POLICY IF EXISTS "auth_all" ON anomalies;
DROP POLICY IF EXISTS "auth_all" ON monthly_summaries;
DROP POLICY IF EXISTS "auth_all" ON categories;
DROP POLICY IF EXISTS "auth_all" ON spending_budgets;

-- New per-user RLS policies
CREATE POLICY "user_own_data" ON accounts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own_data" ON transactions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own_data" ON insights FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own_data" ON goals FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own_data" ON anomalies FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own_data" ON monthly_summaries FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own_data" ON spending_budgets FOR ALL USING (auth.uid() = user_id);

-- Categories remain global/shared: any authenticated user can read
CREATE POLICY "authenticated_read" ON categories FOR SELECT USING (auth.role() = 'authenticated');
