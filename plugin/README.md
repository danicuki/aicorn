# aicorn

Route Claude Code's `WebFetch` through the [agentify](https://github.com/telepenin/aicorn) shared cache. The first agent that visits a URL pays the extraction cost and contributes the cleaned markdown to the cache; every agent after that reads it for a fraction of the tokens.

## What's inside

- **`fetch` skill** — auto-triggered when the user asks Claude to fetch / read / scrape / summarise / extract a URL. Routes the request through `<worker>/fetch?url=<u>&user=<id>` and falls back gracefully on 402 (no credits) or other errors.
- **`setup` skill** (`/aicorn:setup`) — interactive config that writes `.claude/aicorn.local.md` with the Worker URL, your username, and a domain allowlist. Adds the file to `.gitignore` so your username doesn't end up in git history.

## Install

Add this directory to a Claude Code plugin marketplace:

```jsonc
// .claude/marketplace.json (project-local) or ~/.claude/marketplace.json (user)
{
  "name": "local",
  "owner": "you",
  "plugins": [
    { "source": "/absolute/path/to/this/plugin/directory" }
  ]
}
```

Then in Claude Code:

```
/plugin install aicorn@local
```

Alternatively, push the plugin directory to GitHub and add the repo URL as a marketplace source.

## Configure

Once installed, run:

```
/aicorn:setup
```

You'll be prompted for:
- `worker_url` — agentify Worker base URL (default: `https://agentify.mikhailnovikov.workers.dev`)
- `username` — any string; sent as `?user=...` to attribute reads/charges
- `domains` — comma-separated hostnames OR `*` for all hosts

The skill writes `.claude/aicorn.local.md` and adds it to `.gitignore`.

## How it works

1. User asks Claude to fetch a URL.
2. The `fetch` skill reads `.claude/aicorn.local.md`.
3. If the URL's host matches the allowlist, Claude calls `WebFetch(<worker>/fetch?url=<u>&user=<name>)` instead of the origin.
4. The Worker returns clean markdown — from KV cache on hit, from Workers AI extraction on miss.
5. Claude's `WebFetch` sub-model summarises the markdown as if it had come from the origin directly.

If agentify returns 402 (out of credits) or is unreachable, the skill asks before falling back to a direct `WebFetch`.

## Self-hosting agentify

The default Worker URL points at a hackathon demo. To run your own:

```bash
git clone https://github.com/telepenin/aicorn
cd aicorn
npm install
npx wrangler kv namespace create AGENTIFY_CACHE
# paste the returned IDs into wrangler.toml
npx wrangler deploy
```

Then re-run `/aicorn:setup` and point `worker_url` at your deployment.

## License

MIT — see [LICENSE](./LICENSE).
