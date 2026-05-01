import TurndownService from "turndown";
import type { Pipe, Sample } from "./types";

const PRICE_PER_M_INPUT_USD = 3; // Claude Sonnet 4.6 input rate

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

function tokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function cost(t: number): number {
  return (t * PRICE_PER_M_INPUT_USD) / 1_000_000;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; duration_ms: number }> {
  const t0 = Date.now();
  const value = await fn();
  return { value, duration_ms: Date.now() - t0 };
}

// Append a cache-busting query param so a single URL produces a different
// agentify cache key. Origins ignore unknown query params; agentify keys
// its cache by sha256(url) so a new param value = new cache slot.
function cacheBust(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_aicorn_bust=${Date.now()}`;
}

async function callAicorn(routed: string): Promise<{ res: Response; body: string; duration_ms: number }> {
  const { value: res, duration_ms } = await timed(() => fetch(routed, { redirect: "follow" }));
  const body = await res.text();
  return { res, body, duration_ms };
}

export async function sampleAicorn(url: string, workerUrl: string, username: string): Promise<Sample> {
  const userParam = encodeURIComponent(username);
  const buildRouted = (target: string) => `${workerUrl}/fetch?url=${encodeURIComponent(target)}&user=${userParam}`;

  try {
    // Try the cached URL first. If the entry is stale (some legacy entries
    // return 404 url_not_processed), retry once with a cache-buster. Don't
    // retry on 402 — that's "out of credits", retrying just wastes a request.
    let { res, body, duration_ms } = await callAicorn(buildRouted(url));
    if (res.status === 404 && body.includes("url_not_processed")) {
      const retry = await callAicorn(buildRouted(cacheBust(url)));
      res = retry.res;
      body = retry.body;
      duration_ms += retry.duration_ms;
    }
    const ok = res.ok;
    return {
      pipe: "aicorn",
      ok,
      status: res.status,
      bytes: body.length,
      tokens: tokens(body),
      cost_usd: cost(tokens(body)),
      duration_ms,
      error: ok ? undefined : body.slice(0, 200),
    };
  } catch (err) {
    return {
      pipe: "aicorn",
      ok: false,
      status: 0,
      bytes: 0,
      tokens: 0,
      cost_usd: 0,
      duration_ms: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function sampleRawAndTurndown(url: string): Promise<{ raw: Sample; turndown: Sample }> {
  let html = "";
  let status = 0;
  let ok = false;
  let duration_ms = 0;
  let error: string | undefined;
  try {
    const { value: res, duration_ms: d } = await timed(() =>
      fetch(url, {
        redirect: "follow",
        headers: { "user-agent": "aicorn-bench/0.1 (+https://github.com/telepenin/aicorn)" },
      }),
    );
    duration_ms = d;
    status = res.status;
    ok = res.ok;
    html = await res.text();
    if (!ok) error = `origin ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const raw: Sample = {
    pipe: "raw_html",
    ok,
    status,
    bytes: html.length,
    tokens: tokens(html),
    cost_usd: cost(tokens(html)),
    duration_ms,
    error,
  };

  let md = "";
  let mdError: string | undefined = error;
  let mdDuration = 0;
  if (ok && html) {
    const t0 = Date.now();
    try {
      md = turndown.turndown(html);
    } catch (err) {
      mdError = err instanceof Error ? err.message : String(err);
    }
    mdDuration = Date.now() - t0;
  }

  const turndownSample: Sample = {
    pipe: "turndown",
    ok: ok && !mdError && md.length > 0,
    status,
    bytes: md.length,
    tokens: tokens(md),
    cost_usd: cost(tokens(md)),
    duration_ms: duration_ms + mdDuration,
    error: mdError,
  };

  return { raw, turndown: turndownSample };
}

// Re-export so callers don't need to import TurndownService.
export { tokens as estimateTokens, cost as costForTokens, PRICE_PER_M_INPUT_USD };

// Type guard helper for filtering by pipe in tests/scripts.
export function isPipe(x: unknown): x is Pipe {
  return x === "aicorn" || x === "raw_html" || x === "turndown";
}
