---
name: setup
description: This skill should be used when the user asks to "set up aicorn", "configure aicorn", "initialize aicorn", "enable agentify caching", "set my agentify username", "change agentify worker URL", or invokes the `/aicorn:setup` slash command. Writes a `.claude/aicorn.local.md` file at the project root with the agentify Worker URL, username, and domain allowlist that the companion `fetch` skill reads.
argument-hint: [worker_url] [username] [domains]
allowed-tools: Read, Write, Bash, AskUserQuestion
---

# Setting up aicorn

Write a per-project configuration file at `.claude/aicorn.local.md` that the companion `fetch` skill reads to decide where and how to route `WebFetch` calls. The file uses YAML frontmatter for machine-readable values.

## Inputs

Three values are needed:

1. `worker_url` — base URL of an agentify Worker (e.g. `https://agentify.mikhailnovikov.workers.dev`). No trailing slash, no `/fetch` suffix.
2. `username` — sent as the `user` query parameter on every routed fetch. Any string the user prefers.
3. `domains` — comma-separated allowlist of hostnames (`"wikipedia.org,auchan.pt"`) OR the literal string `*` for all hosts.

## Step 1 — Collect values

Positional arguments are available as `$1` (worker_url), `$2` (username), `$3` (domains). An empty or missing argument means "ask the user".

Before prompting, attempt to read any existing `.claude/aicorn.local.md` (use the `Read` tool). If it exists, use its current frontmatter values as the defaults shown to the user — that way running `/aicorn:setup` to change just one field doesn't blow away the others.

When values are missing, ask via `AskUserQuestion` with these defaults:
- `worker_url` default: existing value if present, else `https://agentify.mikhailnovikov.workers.dev`.
- `username` default: existing value if present, else leave blank — the user must type one.
- `domains` default: existing value if present, else `*`.

## Step 2 — Validate and normalise

Apply each rule. On failure, auto-fix where safe and confirm with the user before proceeding; reject and re-prompt only when no safe fix exists.

| Field | Rule | If broken |
|---|---|---|
| `worker_url` | Must start with `http://` or `https://`. | Reject and re-prompt. |
| `worker_url` | Trailing `/`. | Strip silently. |
| `worker_url` | Contains `/fetch` or other path. | Reject and re-prompt — the user supplied the wrong URL. |
| `username` | Non-empty. | Reject and re-prompt. |
| `username` | Contains whitespace, `?`, `&`, `/`, `#`. | Replace each bad char with `-`, show the cleaned value, ask the user to confirm or supply a different one. |
| `domains` | Equals `*` OR comma-separated tokens each matching `^[a-z0-9.-]+$`. | Reject and re-prompt — common mistakes are leaving in `https://` or trailing paths. |

## Step 3 — Health-check the Worker

Before writing the config, verify the Worker is reachable. Substitute the validated `worker_url` directly into the curl command — do NOT rely on environment variables. Run via `Bash`:

```bash
curl -fsS -m 5 "https://agentify.mikhailnovikov.workers.dev/" 2>&1
```

(replace the URL with the actual `worker_url` value at runtime).

Expected response body: `agentify ok`.

- Reachable: continue.
- Non-200 / timeout / network error: tell the user the Worker is unreachable, ask whether to save anyway (perhaps the Worker has not been deployed yet) or abort. Default to abort.

## Step 4 — Write `.claude/aicorn.local.md`

Create the `.claude` directory if it does not exist (`mkdir -p .claude`). Write the file via the `Write` tool, OVERWRITING any prior content. The defaults pulled in Step 1 ensure no field gets reset by accident.

File content — substitute the validated values for the placeholders shown in `<>`. Do NOT copy the placeholder names verbatim into the file:

```markdown
---
worker_url: <WORKER_URL>
username: <USERNAME>
domains: <DOMAINS>
---

# aicorn local config

Edit the YAML frontmatter above to change settings. The `fetch` skill
reads these values on the first WebFetch of each session.

- `worker_url` — base URL of the agentify Worker. No trailing slash, no /fetch.
- `username` — sent as `?user=...` on every /fetch call.
- `domains` — comma-separated hostname allowlist, or `*` for all hosts.
```

YAML gotcha: if `domains` is the literal `*`, write it quoted as `domains: "*"`. Bare `*` is interpreted as a YAML alias and will fail to parse.

## Step 5 — Add to `.gitignore`

Run from the project's git root so the entry lands in the right `.gitignore`:

```bash
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
grep -qxF '.claude/aicorn.local.md' .gitignore 2>/dev/null \
  || echo '.claude/aicorn.local.md' >> .gitignore
```

If `.gitignore` does not exist, do NOT create one — the user may have intentional reasons. Just skip and tell them: "No .gitignore present — the config file at `.claude/aicorn.local.md` may end up in git history. Consider adding it manually if that matters."

A redundant entry is possible if the user already ignores `.claude/` more broadly — that is harmless.

## Step 6 — Confirm

Print:

```
Saved .claude/aicorn.local.md
  worker_url: <url>
  username:   <name>
  domains:    <list>

The fetch skill will route WebFetch calls through this Worker.
Try `fetch https://en.wikipedia.org/wiki/Cache` to verify routing.
```

If the health check failed and the user opted to save anyway, append: "Note: Worker was unreachable at save time; routed fetches will fail until the Worker is online."

## Re-running setup

This skill always overwrites the existing file. Step 1's "read existing values as defaults" preserves any field the user does not change. To wipe the config entirely, the user can `rm .claude/aicorn.local.md` first.
