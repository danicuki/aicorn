<p align="center">
  <img src="assets/logo-lockup.svg" alt="Aicorn" width="360">
</p>

<p align="center"><em>Crack the page once. Share the kernel.</em></p>

---

**Aicorn** is a shared, credit-metered cache for agent-friendly web content. Built on Cloudflare Workers, Workers AI, and KV.

Every AI agent re-extracts the same HTML from the same websites and pays for the same LLM tokens to clean it up. Aicorn is the squirrel-network: one agent cracks the page, the kernel is stored, and every other agent harvests from the shared hoard. Contributors earn credits when their kernel is read.

## Docs

- **[PROJECT.md](PROJECT.md)** — full project scope, architecture, economics, demo plan
- **[TEAM.md](TEAM.md)** — 5-hour build job split for Daniel, Nikolay, Mikhail
- **[BRAND.md](BRAND.md)** — colors, typography, logo, voice, paste-able CSS

## The demo

Two agents, same URL, ten seconds apart.

```
Agent A → MISS → 8,000 tokens → $0.02 → contributor
Agent B → HIT  →   400 tokens → $0    → reader pays 10, contributor earns 9
```

Same content. Same agent quality. **20× cheaper.**

## Stack

Cloudflare Workers · Workers AI · KV · TypeScript

## Status

Hackathon build, 5-hour scope. See [TEAM.md](TEAM.md) for current ownership.
