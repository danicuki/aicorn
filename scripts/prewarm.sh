#!/usr/bin/env bash
set -euo pipefail

# Pre-warms the demo URL so the on-stage HIT works no matter what.
# Usage: WORKER_URL=https://agentify.your-account.workers.dev DEMO_URL=https://... ./scripts/prewarm.sh

: "${WORKER_URL:?must set WORKER_URL}"
: "${DEMO_URL:?must set DEMO_URL}"

echo "Pre-warming $DEMO_URL via $WORKER_URL"
curl -fsS -D- "$WORKER_URL/fetch?url=$DEMO_URL&user=prewarm" -o /dev/null
echo
echo "Cache should now be primed. Run a HIT to verify:"
echo "  curl -sD- '$WORKER_URL/fetch?url=$DEMO_URL&user=judge'"
