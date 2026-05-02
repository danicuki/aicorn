#!/usr/bin/env bash
set -euo pipefail

# Deploy both aicorn Workers in dependency order.
#
#   1. aicorn-ledger  (D1-backed, called via Service Binding)
#   2. aicorn         (pipeline; declares  [[services]] binding = "LEDGER")
#
# The pipeline's Service Binding is late-bound at request time, so technically
# the deploy order does not affect *deployment success* — but it does affect
# the window during which a freshly-deployed pipeline can serve requests
# without 502'ing on a missing ledger. Deploy ledger first, every time.
#
# The ledger's wrangler.jsonc has no account_id pinned. We export
# CLOUDFLARE_ACCOUNT_ID by reading it from the pipeline's wrangler.toml so
# both Workers land on the same account without duplicating the value.

cd "$(dirname "$0")/.."

ACCOUNT_ID=$(grep -E '^account_id' wrangler.toml | cut -d'"' -f2)
if [[ -z "${ACCOUNT_ID:-}" ]]; then
  echo "✘ Could not parse account_id from wrangler.toml" >&2
  exit 1
fi
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"

echo "→ Deploying aicorn-ledger (account $ACCOUNT_ID)..."
( cd ledger && npx wrangler deploy )
echo

echo "→ Deploying aicorn pipeline (account $ACCOUNT_ID)..."
npx wrangler deploy
echo

echo "✓ Both Workers deployed."
echo "    pipeline: https://aicorn.<your-subdomain>.workers.dev"
echo "    ledger:   https://aicorn-ledger.<your-subdomain>.workers.dev"
