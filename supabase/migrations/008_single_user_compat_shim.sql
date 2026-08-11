-- Compatibility shim: let the pre-multi-user code on `main` keep working
-- against the post-007 schema, without merging the `multiuser` branch.
--
-- After 007, accounts.user_id and transactions.user_id are NOT NULL, but the
-- code deployed from main never sets user_id — so every webhook insert fails.
-- 005 also dropped accounts_redbark_name_key, while main still upserts with
-- `onConflict: "redbark_name"`, which errors 42P10.
--
-- This is a SINGLE-USER shim. Both changes must be reverted when the multiuser
-- branch is merged and deployed — see the teardown block at the bottom.

BEGIN;

DO $$
DECLARE
  auth_count   int;
  sole_user_id uuid;
BEGIN
  SELECT count(*)::int INTO auth_count FROM auth.users;

  IF auth_count <> 1 THEN
    RAISE EXCEPTION
      'This shim only makes sense for a single-user deployment; found % auth users. Merge the multiuser branch instead.',
      auth_count;
  END IF;

  SELECT id INTO sole_user_id FROM auth.users LIMIT 1;

  -- 1. Default ownership so inserts that omit user_id still satisfy NOT NULL
  --    and land owned by the right user (so RLS shows them).
  EXECUTE format('ALTER TABLE accounts          ALTER COLUMN user_id SET DEFAULT %L', sole_user_id);
  EXECUTE format('ALTER TABLE transactions      ALTER COLUMN user_id SET DEFAULT %L', sole_user_id);

  -- These are still nullable, but a NULL owner means RLS hides the row — so
  -- default them too, otherwise anomalies and insights silently vanish.
  EXECUTE format('ALTER TABLE anomalies         ALTER COLUMN user_id SET DEFAULT %L', sole_user_id);
  EXECUTE format('ALTER TABLE insights          ALTER COLUMN user_id SET DEFAULT %L', sole_user_id);
  EXECUTE format('ALTER TABLE goals             ALTER COLUMN user_id SET DEFAULT %L', sole_user_id);
  EXECUTE format('ALTER TABLE monthly_summaries ALTER COLUMN user_id SET DEFAULT %L', sole_user_id);
  EXECUTE format('ALTER TABLE spending_budgets  ALTER COLUMN user_id SET DEFAULT %L', sole_user_id);
END $$;

-- 2. Restore the unique constraint main's upserts name in onConflict.
--    Safe while there is one user, and it structurally prevents the duplicate
--    accounts that caused the original outage. MUST be dropped before a second
--    user exists — two users cannot otherwise share an account name.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_redbark_name_key
  ON accounts (redbark_name);

COMMIT;

-- ---------------------------------------------------------------------------
-- TEARDOWN — run this when the multiuser branch is merged and deployed.
-- The application then sets user_id explicitly and conflicts on the composite
-- indexes, so both changes above become wrong.
--
--   BEGIN;
--   ALTER TABLE accounts          ALTER COLUMN user_id DROP DEFAULT;
--   ALTER TABLE transactions      ALTER COLUMN user_id DROP DEFAULT;
--   ALTER TABLE anomalies         ALTER COLUMN user_id DROP DEFAULT;
--   ALTER TABLE insights          ALTER COLUMN user_id DROP DEFAULT;
--   ALTER TABLE goals             ALTER COLUMN user_id DROP DEFAULT;
--   ALTER TABLE monthly_summaries ALTER COLUMN user_id DROP DEFAULT;
--   ALTER TABLE spending_budgets  ALTER COLUMN user_id DROP DEFAULT;
--   DROP INDEX IF EXISTS accounts_redbark_name_key;
--   COMMIT;
-- ---------------------------------------------------------------------------
