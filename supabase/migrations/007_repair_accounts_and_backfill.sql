-- Repair the NULL user_id fallout from 005 and stop it recurring.
--
-- Supersedes 006_backfill_user_id.sql — run this INSTEAD of 006. Safe to
-- re-run: every step is guarded or idempotent.
--
-- Background: user_profiles was empty, so the Redbark webhook could not match
-- a user and wrote every account and transaction with user_id = NULL. Postgres
-- treats NULLs as distinct in unique indexes, so the (redbark_name, user_id)
-- index added in 005 never matched and each delivery inserted a fresh
-- duplicate account. RLS (auth.uid() = user_id) then hid every row.
--
-- Order matters: transactions.account_id is ON DELETE CASCADE, so duplicate
-- accounts MUST be repointed before they can be deleted.

BEGIN;

-- 1. Every auth user needs a profile row. The 005 trigger only fires for new
--    signups, so pre-existing users were never given one.
INSERT INTO user_profiles (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

DO $$
DECLARE
  auth_count   int;
  sole_user_id uuid;
  stragglers   int;
  dupes        int;
BEGIN
  SELECT count(*)::int INTO auth_count FROM auth.users;

  IF auth_count <> 1 THEN
    RAISE EXCEPTION
      'This migration assumes a single auth user; found %. Stopping so nothing is mis-assigned.',
      auth_count;
  END IF;

  SELECT id INTO sole_user_id FROM auth.users LIMIT 1;

  -- 2. Repoint transactions from duplicate accounts onto the canonical row
  --    (the one that already carries a user_id) before anything is deleted.
  UPDATE transactions t
  SET account_id = canon.id
  FROM accounts dup
  JOIN accounts canon
    ON canon.redbark_name = dup.redbark_name
   AND canon.user_id IS NOT NULL
  WHERE t.account_id = dup.id
    AND dup.user_id IS NULL;

  -- 3. Guard: refuse to delete while anything still references a duplicate.
  --    Without this, the CASCADE would take the transactions with it.
  SELECT count(*)::int INTO stragglers
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  WHERE a.user_id IS NULL;

  IF stragglers > 0 THEN
    RAISE EXCEPTION
      'Aborting: % transactions still reference duplicate accounts. Nothing deleted.',
      stragglers;
  END IF;

  -- 4. Now safe to remove the duplicates.
  DELETE FROM accounts dup
  USING accounts canon
  WHERE dup.user_id IS NULL
    AND canon.redbark_name = dup.redbark_name
    AND canon.user_id IS NOT NULL;

  -- 5. Any account with no canonical twin just gets claimed.
  UPDATE accounts SET user_id = sole_user_id WHERE user_id IS NULL;

  -- 6. spending_budgets is UNIQUE on user_id. Keep the most recent orphan only
  --    if the sole user has no budget yet; otherwise drop the orphans.
  IF EXISTS (SELECT 1 FROM spending_budgets WHERE user_id = sole_user_id) THEN
    DELETE FROM spending_budgets WHERE user_id IS NULL;
  ELSE
    UPDATE spending_budgets
    SET user_id = sole_user_id
    WHERE id = (
      SELECT id FROM spending_budgets WHERE user_id IS NULL
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 1
    );
    DELETE FROM spending_budgets WHERE user_id IS NULL;
  END IF;

  -- 7. Claim everything else.
  UPDATE transactions       SET user_id = sole_user_id WHERE user_id IS NULL;
  UPDATE insights           SET user_id = sole_user_id WHERE user_id IS NULL;
  UPDATE goals              SET user_id = sole_user_id WHERE user_id IS NULL;
  UPDATE monthly_summaries  SET user_id = sole_user_id WHERE user_id IS NULL;
  UPDATE anomalies          SET user_id = sole_user_id WHERE user_id IS NULL;

  SELECT count(*)::int INTO dupes
  FROM (
    SELECT redbark_name FROM accounts GROUP BY redbark_name HAVING count(*) > 1
  ) d;

  RAISE NOTICE 'Backfill complete. Remaining duplicate account names: %', dupes;
END $$;

-- 8. Make the NULL state unrepresentable. This is what actually stops the
--    recurrence: with user_id NOT NULL, the (redbark_name, user_id) and
--    (redbark_account_id, user_id) indexes from 005 finally bind, so an
--    upsert matches an existing row instead of inserting a duplicate.
ALTER TABLE accounts     ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN user_id SET NOT NULL;

COMMIT;
