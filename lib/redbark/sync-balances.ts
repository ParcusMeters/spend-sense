import type { SupabaseClient } from "@supabase/supabase-js";

const REDBARK_API_BASE = "https://api.redbark.co/v1";

type RedbarkAccount = {
  id: string;
  connectionId: string;
  provider: string | null;
  name: string;
  type: string;
  institutionName: string | null;
  accountNumber: string | null;
  currency: string;
};

type AccountsListResponse = {
  data: RedbarkAccount[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
};

type BalancesResponse = {
  data: Array<{
    accountId: string;
    currentBalance: string;
    availableBalance: string;
    currency: string;
  }>;
};

type LocalAccountRow = {
  id: string;
  redbark_name: string;
  redbark_account_id: string | null;
};

function normalizeAccountType(apiType: string): string {
  return apiType.toLowerCase().replace(/\s+/g, "_") || "transaction";
}

async function redbarkFetch<T>(path: string, apiKey: string): Promise<T> {
  const url = `${REDBARK_API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Redbark ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function listAllAccounts(apiKey: string): Promise<RedbarkAccount[]> {
  const all: RedbarkAccount[] = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const page = await redbarkFetch<AccountsListResponse>(`/accounts?${q}`, apiKey);
    all.push(...page.data);
    hasMore = page.pagination.hasMore;
    offset += page.data.length;
    if (page.data.length === 0) break;
  }

  return all;
}

async function fetchBalancesForIds(
  apiKey: string,
  accountIds: string[]
): Promise<Map<string, BalancesResponse["data"][0]>> {
  const map = new Map<string, BalancesResponse["data"][0]>();
  const batchSize = 100;

  for (let i = 0; i < accountIds.length; i += batchSize) {
    const batch = accountIds.slice(i, i + batchSize);
    const q = new URLSearchParams({ accountIds: batch.join(",") });
    const { data } = await redbarkFetch<BalancesResponse>(`/balances?${q}`, apiKey);
    for (const row of data) {
      map.set(row.accountId, row);
    }
  }

  return map;
}

export async function fetchRedbarkTotalBalanceCents(): Promise<number | null> {
  const apiKey = process.env.REDBARK_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const rbAccounts = await listAllAccounts(apiKey);
    if (rbAccounts.length === 0) return 0;

    const balanceById = await fetchBalancesForIds(
      apiKey,
      rbAccounts.map((a) => a.id)
    );

    let totalCents = 0;
    for (const acc of rbAccounts) {
      const bal = balanceById.get(acc.id);
      if (!bal) continue;

      const balanceDollars = Number.parseFloat(bal.currentBalance);
      if (!Number.isFinite(balanceDollars)) continue;
      totalCents += Math.round(balanceDollars * 100);
    }

    return totalCents;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("fetchRedbarkTotalBalanceCents:", message);
    return null;
  }
}

/**
 * Pulls live balances from Redbark REST API and upserts `accounts` in Supabase.
 * No-op if REDBARK_API_KEY is unset (webhook-only setups keep using manual DB balances).
 */
export async function syncRedbarkBalancesToDatabase(
  supabase: SupabaseClient
): Promise<{ updated: number; error?: string }> {
  const apiKey = process.env.REDBARK_API_KEY?.trim();
  if (!apiKey) {
    return { updated: 0 };
  }

  try {
    const rbAccounts = await listAllAccounts(apiKey);
    if (rbAccounts.length === 0) {
      return { updated: 0 };
    }

    const balanceById = await fetchBalancesForIds(
      apiKey,
      rbAccounts.map((a) => a.id)
    );

    const { data: locals, error: localErr } = await supabase
      .from("accounts")
      .select("id, redbark_name, redbark_account_id");

    if (localErr) {
      console.error("syncRedbarkBalancesToDatabase: failed to read accounts", localErr);
      return { updated: 0, error: localErr.message };
    }

    const localRows = (locals ?? []) as LocalAccountRow[];
    const matchedLocalIds = new Set<string>();
    let updated = 0;
    const now = new Date().toISOString();

    for (const acc of rbAccounts) {
      const bal = balanceById.get(acc.id);
      if (!bal) continue;

      const balanceDollars = Number.parseFloat(bal.currentBalance);
      if (Number.isNaN(balanceDollars)) continue;

      let local = localRows.find((l) => l.redbark_account_id === acc.id);
      if (local && matchedLocalIds.has(local.id)) {
        local = undefined;
      }
      if (!local) {
        local = localRows.find((l) => !matchedLocalIds.has(l.id) && l.redbark_name === acc.name);
      }

      const institution = acc.institutionName?.trim() || "Unknown";
      const currency = (acc.currency || bal.currency || "AUD").toUpperCase();
      const type = normalizeAccountType(acc.type);

      if (local) {
        matchedLocalIds.add(local.id);
        const { error } = await supabase
          .from("accounts")
          .update({
            redbark_account_id: acc.id,
            redbark_name: acc.name,
            institution,
            type,
            balance: balanceDollars,
            currency,
            last_synced_at: now,
            updated_at: now,
          })
          .eq("id", local.id);

        if (error) {
          console.error("syncRedbarkBalancesToDatabase: update failed", error);
          return { updated, error: error.message };
        }
        updated++;
      } else {
        const { error } = await supabase.from("accounts").upsert(
          {
            redbark_account_id: acc.id,
            redbark_name: acc.name,
            institution,
            type,
            balance: balanceDollars,
            currency,
            last_synced_at: now,
            updated_at: now,
          },
          { onConflict: "redbark_name" }
        );

        if (error) {
          console.error("syncRedbarkBalancesToDatabase: upsert failed", error);
          return { updated, error: error.message };
        }
        updated++;
      }
    }

    return { updated };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("syncRedbarkBalancesToDatabase:", message);
    return { updated: 0, error: message };
  }
}
