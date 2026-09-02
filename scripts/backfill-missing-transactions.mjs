// Backfill transactions that Redbark delivered but the app failed to persist.
//
// Redbark's webhook destinations have no replay mechanism: the sync sends new rows
// once per run and the endpoint acknowledges immediately, so a downstream failure
// loses the payload permanently. This script re-inserts such rows from a JSON file
// prepared from the Redbark API.
//
// Insert-only: rows whose redbark_id already exists are left untouched, so it is
// safe to re-run.
//
//   node scripts/backfill-missing-transactions.mjs <rows.json> [--dry-run]
//
// Each row must already match the transactions table shape (redbark_id, user_id,
// account_id, date, description, amount_cents, ...).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [rowsPath, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");

if (!rowsPath) {
  console.error("usage: node scripts/backfill-missing-transactions.mjs <rows.json> [--dry-run]");
  process.exit(1);
}

function loadEnv(path) {
  const env = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let value = m[2];
      const quoted = value.match(/^(["'])(.*)\1\s*(?:#.*)?$/);
      if (quoted) {
        value = quoted[2];
      } else {
        // strip an unquoted trailing comment: KEY=value # note
        value = value.replace(/\s+#.*$/, "").trim();
      }
      env[m[1]] = value;
    }
  } catch {
    // fall through to process.env
  }
  return env;
}

const fileEnv = loadEnv(new URL("../.env.local", import.meta.url).pathname);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const rows = JSON.parse(readFileSync(rowsPath, "utf8"));

const required = ["redbark_id", "user_id", "account_id", "date", "description", "amount_cents", "direction"];
for (const [i, row] of rows.entries()) {
  for (const field of required) {
    if (row[field] === undefined || row[field] === null) {
      console.error(`row ${i} (${row.redbark_id ?? "?"}) missing ${field}`);
      process.exit(1);
    }
  }
}

const ids = new Set(rows.map((r) => r.redbark_id));
if (ids.size !== rows.length) {
  console.error(`duplicate redbark_id in input (${rows.length} rows, ${ids.size} unique)`);
  process.exit(1);
}

console.log(`loaded ${rows.length} rows from ${rowsPath}`);
console.log(`date range ${rows.reduce((a, r) => (r.date < a ? r.date : a), rows[0].date)} -> ${rows.reduce((a, r) => (r.date > a ? r.date : a), rows[0].date)}`);

const countRows = async () => {
  const { count, error } = await supabase.from("transactions").select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count;
};

const before = await countRows();
console.log(`transactions before: ${before}`);

if (dryRun) {
  console.log("--dry-run: no writes performed");
  process.exit(0);
}

const BATCH = 50;
let failed = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const n = Math.floor(i / BATCH);
  const { error } = await supabase
    .from("transactions")
    .upsert(batch, { onConflict: "redbark_id", ignoreDuplicates: true });
  if (error) {
    failed += batch.length;
    console.error(`batch ${n} FAILED: ${error.message} ${error.details ?? ""}`);
  } else {
    console.log(`batch ${n}: ${batch.length} rows ok`);
  }
}

const after = await countRows();
console.log(`transactions after: ${after} (inserted ${after - before}, failed ${failed})`);
process.exit(failed > 0 ? 1 : 0);
