#!/usr/bin/env bash
# Repeatedly GET /api/cron/categorise-pending until the server reports nothing left to do.
#
# 1. Fill in CONFIG_* below (or export CRON_SECRET / BASE_URL instead).
# 2. Run from repo root: ./scripts/categorise-until-done.sh
#
# Optional: MAX_ROUNDS=500

set -euo pipefail

# --- edit these ---
CONFIG_CRON_SECRET="chickenclassic"
CONFIG_BASE_URL="https://spend-sense-one.vercel.app/"
# ------------------

CRON_SECRET="${CRON_SECRET:-$CONFIG_CRON_SECRET}"
BASE_URL="${BASE_URL:-$CONFIG_BASE_URL}"
MAX_ROUNDS="${MAX_ROUNDS:-500}"

if [[ -z "$CRON_SECRET" ]]; then
  echo "error: set CONFIG_CRON_SECRET in this script or export CRON_SECRET" >&2
  exit 1
fi

url="${BASE_URL%/}/api/cron/categorise-pending"
echo "hitting: $url" >&2

round=0

while (( round < MAX_ROUNDS )); do
  round=$((round + 1))
  if ! raw=$(curl -sS -w "\n%{http_code}" \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    "$url"); then
    echo "error: curl failed" >&2
    exit 1
  fi

  code=$(echo "$raw" | tail -n1)
  body=$(echo "$raw" | sed '$d')

  if [[ "$code" != 2* ]]; then
    echo "error: HTTP $code — $body" >&2
    exit 1
  fi

  processed=$(node -p "JSON.parse(process.argv[1]).processed ?? 0" "$body")
  failed=$(node -p "JSON.parse(process.argv[1]).failed ?? 0" "$body")
  msg=$(node -p "JSON.parse(process.argv[1]).message ?? \"\"" "$body")

  if [[ -n "$msg" ]]; then
    echo "round $round: processed=$processed failed=$failed ($msg)"
  else
    echo "round $round: processed=$processed failed=$failed"
  fi

  if [[ "$processed" -eq 0 && "$failed" -eq 0 ]]; then
    echo "done: nothing left to categorise."
    exit 0
  fi
done

echo "error: stopped after $MAX_ROUNDS rounds (safety cap). Check failed txns or raise MAX_ROUNDS." >&2
exit 2
