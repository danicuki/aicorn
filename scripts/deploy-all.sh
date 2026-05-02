#!/usr/bin/env bash
set -euo pipefail

# Deploy both aicorn Workers in dependency order.
#
#   1. aicorn-ledger  (D1-backed, called via Service Binding)
#   2. aicorn         (pipeline; declares  [[services]] binding = "LEDGER")
#
# Service Bindings are late-bound at request time, so deploy order does not
# affect deployment success — but ledger-first closes the brief window where
# a freshly-deployed pipeline can 502 on a missing binding target.

cd "$(dirname "$0")/.."

echo "→ Deploying aicorn-ledger..."
( cd ledger && npx wrangler deploy )
echo

echo "→ Deploying aicorn pipeline..."
( cd pipeline && npx wrangler deploy )
echo

echo "✓ Both Workers deployed."
