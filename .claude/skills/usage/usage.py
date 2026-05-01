#!/usr/bin/env python3
"""Cloudflare current-day usage report against free-tier limits.

Pulls data from the GraphQL Analytics API at api.cloudflare.com using
wrangler's OAuth token (run `wrangler login` once before invoking).

Datasets queried:
  - workersInvocationsAdaptive       (requests, errors, subrequests)
  - kvOperationsAdaptiveGroups       (reads/writes/deletes/lists)
  - d1AnalyticsAdaptiveGroups        (rows read, rows written)
  - aiInferenceAdaptiveGroups        (inference count by model)

Browser Rendering usage is not yet exposed through GraphQL Analytics;
the dashboard at https://dash.cloudflare.com is the only source for now.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql"

LIMITS = {
    "workers_requests": 100_000,
    "kv_reads": 100_000,
    "kv_writes": 1_000,
    "kv_deletes": 1_000,
    "kv_lists": 1_000,
    "d1_rows_read": 5_000_000,
    "d1_rows_written": 100_000,
    "ai_neurons": 10_000,
}

# Coarse Neurons-per-inference estimates (input ~7.5k tokens, output ~1.5k).
# These exist so the skill can give a "are we close to the 10k budget?"
# answer without exact token counts (which the GraphQL dataset does not
# expose). For accurate numbers, use the dashboard.
AI_NEURONS_PER_INFERENCE = {
    "@cf/meta/llama-3.2-1b-instruct": 35,
    "@cf/meta/llama-3.2-3b-instruct": 80,
    "@cf/meta/llama-3.1-8b-instruct": 250,
}
DEFAULT_NEURONS_PER_INFERENCE = 100


def find_wrangler_toml() -> Path:
    cwd = Path.cwd()
    for d in [cwd, *cwd.parents]:
        candidate = d / "wrangler.toml"
        if candidate.exists():
            return candidate
    sys.exit("error: wrangler.toml not found in CWD or any parent directory")


def parse_account_id(toml_path: Path) -> str:
    text = toml_path.read_text()
    m = re.search(r'^account_id\s*=\s*"([^"]+)"', text, re.MULTILINE)
    if not m:
        sys.exit(f"error: account_id not found in {toml_path}")
    return m.group(1)


def get_token() -> str:
    """Last line of `wrangler auth token` output is the token itself."""
    for cmd in (["wrangler", "auth", "token"], ["npx", "--yes", "wrangler", "auth", "token"]):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        except FileNotFoundError:
            continue
        if r.returncode != 0:
            continue
        lines = [ln.strip() for ln in r.stdout.splitlines() if ln.strip()]
        if lines:
            return lines[-1]
    sys.exit(
        "error: could not run `wrangler auth token`. Install wrangler "
        "and run `wrangler login` once."
    )


def gql(query: str, token: str) -> dict[str, Any]:
    body = json.dumps({"query": query}).encode("utf-8")
    req = urllib.request.Request(
        GRAPHQL_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if payload.get("errors"):
        sys.exit(f"GraphQL error: {payload['errors']}")
    return payload


def accounts0(payload: dict[str, Any], field: str) -> list[dict[str, Any]]:
    accounts = payload.get("data", {}).get("viewer", {}).get("accounts", [])
    if not accounts:
        return []
    return accounts[0].get(field) or []


def today_utc() -> tuple[str, str, str]:
    now = datetime.now(timezone.utc)
    d = now.strftime("%Y-%m-%d")
    return d, f"{d}T00:00:00Z", f"{d}T23:59:59Z"


def status_label(used: int, limit: int) -> str:
    pct = (used / limit) * 100 if limit else 0.0
    if used >= limit:
        return f"EXCEEDED ({pct:.0f}%)"
    if pct >= 80:
        return f"CRITICAL ({pct:.0f}%)"
    if pct >= 50:
        return f"WARN ({pct:.0f}%)"
    return f"OK ({pct:.1f}%)"


def num(n: int) -> str:
    return f"{n:,}"


def metric_row(label: str, used: int, limit: int) -> str:
    return f"  {label:<18} {num(used):>10} / {num(limit):>10}   {status_label(used, limit)}"


def report_workers(account_id: str, start: str, end: str, token: str) -> None:
    q = f"""query {{
      viewer {{
        accounts(filter: {{accountTag: "{account_id}"}}) {{
          workersInvocationsAdaptive(
            filter: {{datetime_geq: "{start}", datetime_lt: "{end}"}}
            limit: 200
          ) {{
            sum {{ requests errors subrequests }}
            dimensions {{ scriptName }}
          }}
        }}
      }}
    }}"""
    rows = accounts0(gql(q, token), "workersInvocationsAdaptive")

    total_req = sum(r["sum"]["requests"] for r in rows)
    total_err = sum(r["sum"]["errors"] for r in rows)
    total_sub = sum(r["sum"]["subrequests"] for r in rows)
    by_worker: dict[str, int] = {}
    for r in rows:
        name = r["dimensions"]["scriptName"]
        by_worker[name] = by_worker.get(name, 0) + r["sum"]["requests"]

    print()
    print("Workers")
    print(metric_row("Requests", total_req, LIMITS["workers_requests"]))
    print(f"  Errors             {num(total_err):>10}")
    print(f"  Subrequests        {num(total_sub):>10}")
    if by_worker:
        print()
        print("  By script:")
        for name, count in sorted(by_worker.items(), key=lambda x: -x[1]):
            display = name if name != "__unknown__" else "(unattributed)"
            print(f"    {display:<32} {num(count):>10}")


def report_kv(account_id: str, start: str, end: str, token: str) -> None:
    q = f"""query {{
      viewer {{
        accounts(filter: {{accountTag: "{account_id}"}}) {{
          kvOperationsAdaptiveGroups(
            filter: {{datetime_geq: "{start}", datetime_lt: "{end}"}}
            limit: 200
          ) {{
            sum {{ requests }}
            dimensions {{ actionType namespaceId }}
          }}
        }}
      }}
    }}"""
    rows = accounts0(gql(q, token), "kvOperationsAdaptiveGroups")

    by_action: dict[str, int] = {}
    by_ns_action: dict[tuple[str, str], int] = {}
    for r in rows:
        action = r["dimensions"]["actionType"]
        ns = r["dimensions"]["namespaceId"]
        n = r["sum"]["requests"]
        by_action[action] = by_action.get(action, 0) + n
        by_ns_action[(ns, action)] = by_ns_action.get((ns, action), 0) + n

    print()
    print("KV")
    for action, key in (("read", "kv_reads"), ("write", "kv_writes"),
                        ("delete", "kv_deletes"), ("list", "kv_lists")):
        used = by_action.get(action, 0)
        print(metric_row(action.title() + "s", used, LIMITS[key]))

    if by_ns_action:
        ns_ops: dict[str, dict[str, int]] = {}
        for (ns, action), n in by_ns_action.items():
            ns_ops.setdefault(ns, {})[action] = n
        print()
        print("  By namespace:")
        for ns, ops in ns_ops.items():
            ops_str = "  ".join(f"{k}={num(v)}" for k, v in sorted(ops.items()))
            print(f"    {ns[:16]}…  {ops_str}")


def report_d1(account_id: str, date_str: str, token: str) -> None:
    q = f"""query {{
      viewer {{
        accounts(filter: {{accountTag: "{account_id}"}}) {{
          d1AnalyticsAdaptiveGroups(
            filter: {{date_geq: "{date_str}", date_leq: "{date_str}"}}
            limit: 100
          ) {{
            sum {{ rowsRead rowsWritten }}
            dimensions {{ databaseId }}
          }}
        }}
      }}
    }}"""
    rows = accounts0(gql(q, token), "d1AnalyticsAdaptiveGroups")

    total_read = sum(r["sum"]["rowsRead"] for r in rows)
    total_write = sum(r["sum"]["rowsWritten"] for r in rows)
    by_db: dict[str, tuple[int, int]] = {}
    for r in rows:
        db = r["dimensions"]["databaseId"]
        cur_r, cur_w = by_db.get(db, (0, 0))
        by_db[db] = (cur_r + r["sum"]["rowsRead"], cur_w + r["sum"]["rowsWritten"])

    print()
    print("D1")
    print(metric_row("Rows read", total_read, LIMITS["d1_rows_read"]))
    print(metric_row("Rows written", total_write, LIMITS["d1_rows_written"]))
    if by_db:
        print()
        print("  By database:")
        for db, (rr, rw) in sorted(by_db.items(), key=lambda x: -(x[1][0] + x[1][1])):
            print(f"    {db[:8]}…  read={num(rr)}  written={num(rw)}")


def report_ai(account_id: str, start: str, end: str, token: str) -> None:
    q = f"""query {{
      viewer {{
        accounts(filter: {{accountTag: "{account_id}"}}) {{
          aiInferenceAdaptiveGroups(
            filter: {{datetime_geq: "{start}", datetime_lt: "{end}"}}
            limit: 200
          ) {{
            count
            dimensions {{ modelId }}
          }}
        }}
      }}
    }}"""
    rows = accounts0(gql(q, token), "aiInferenceAdaptiveGroups")

    total_inf = sum(r["count"] for r in rows)
    by_model: dict[str, int] = {}
    est_neurons = 0
    for r in rows:
        model = r["dimensions"]["modelId"]
        n = r["count"]
        by_model[model] = by_model.get(model, 0) + n
        per = AI_NEURONS_PER_INFERENCE.get(model, DEFAULT_NEURONS_PER_INFERENCE)
        est_neurons += n * per

    print()
    print("Workers AI")
    print(f"  Inferences         {num(total_inf):>10}")
    print(metric_row("Est. Neurons", est_neurons, LIMITS["ai_neurons"]))
    print("  (Neurons estimated from inference count and per-model heuristics —")
    print("   for exact numbers see https://dash.cloudflare.com/<acct>/ai/workers-ai)")
    if by_model:
        print()
        print("  By model:")
        for model, count in sorted(by_model.items(), key=lambda x: -x[1]):
            print(f"    {model:<42} {num(count):>5}")


def main() -> None:
    toml_path = find_wrangler_toml()
    account_id = parse_account_id(toml_path)
    token = get_token()
    date_str, start, end = today_utc()

    print()
    print(f"Cloudflare usage — {date_str} UTC (since 00:00)")
    print(f"Account: {account_id[:8]}…  (from {toml_path})")
    print("─" * 64)

    report_workers(account_id, start, end, token)
    report_kv(account_id, start, end, token)
    report_d1(account_id, date_str, token)
    report_ai(account_id, start, end, token)

    print()
    print("─" * 64)
    print("Source: api.cloudflare.com/client/v4/graphql")
    print("Auth:   wrangler OAuth (use `wrangler logout` to revoke)")
    print("Browser Rendering usage is not in GraphQL Analytics — check the dashboard.")
    print()


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} from Cloudflare API: {e.read().decode('utf-8', 'replace')[:300]}")
    except Exception as e:
        sys.exit(f"error: {e}")
