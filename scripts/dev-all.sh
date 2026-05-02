#!/usr/bin/env bash
set -euo pipefail

# Run both aicorn Workers locally for end-to-end development.
#
#   ledger:   :8788
#   pipeline: :8787
#
# Wrangler resolves the pipeline's [[services]] binding (LEDGER →
# "aicorn-ledger") to the local ledger Worker when both are running.
# Ctrl-C in this terminal stops both.

cd "$(dirname "$0")/.."

LEDGER_PORT=8788
PIPELINE_PORT=8787

LEDGER_PID=""
cleanup() {
  if [[ -n "$LEDGER_PID" ]] && kill -0 "$LEDGER_PID" 2>/dev/null; then
    echo
    echo "→ Stopping aicorn-ledger (pid $LEDGER_PID + children)..."
    # Kill children too — wrangler dev forks esbuild/miniflare, and a bare
    # `kill $LEDGER_PID` orphans them holding the port for the next run.
    pkill -P "$LEDGER_PID" 2>/dev/null || true
    kill "$LEDGER_PID" 2>/dev/null || true
    wait "$LEDGER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "→ Starting aicorn-ledger on :$LEDGER_PORT..."
( cd ledger && npx wrangler dev --port "$LEDGER_PORT" ) &
LEDGER_PID=$!

# Poll for the ledger to bind its port. Cold tsx + wrangler boot can take
# 10–30s on a fresh install, so a fixed sleep is unreliable.
echo -n "  waiting for ledger to be reachable"
for _ in $(seq 1 150); do
  if nc -z localhost "$LEDGER_PORT" 2>/dev/null; then
    echo " ✓"
    break
  fi
  echo -n "."
  sleep 0.2
done

echo "→ Starting aicorn pipeline on :$PIPELINE_PORT..."
echo "    Service binding LEDGER → aicorn-ledger (resolves to localhost:$LEDGER_PORT)"
echo
npx wrangler dev --port "$PIPELINE_PORT"
