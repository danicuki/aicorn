import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sampleAicorn, sampleRawAndTurndown, PRICE_PER_M_INPUT_USD } from "./fetch";
import { writeReports } from "./report";
import type { Report, UrlResult } from "./types";

const ROOT = resolve(import.meta.dirname, "..");
const SITES_PATH = resolve(ROOT, "sites.txt");
const RESULTS_DIR = resolve(ROOT, "results");

const WORKER_URL = process.env.AICORN_WORKER_URL ?? "https://aicorn.mikhailnovikov.workers.dev";
const USERNAME = process.env.AICORN_USER ?? "bench";
const DELAY_MS = Number(process.env.AICORN_DELAY_MS ?? "1500"); // breather between URLs to respect agentify rate limits

function loadSites(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

async function runUrl(url: string): Promise<UrlResult> {
  const [aicorn, rawAndTurndown] = await Promise.all([
    sampleAicorn(url, WORKER_URL, USERNAME),
    sampleRawAndTurndown(url),
  ]);
  return {
    url,
    samples: {
      aicorn,
      raw_html: rawAndTurndown.raw,
      turndown: rawAndTurndown.turndown,
    },
  };
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

const sites = loadSites(SITES_PATH);
console.error(`benchmarking ${sites.length} URLs against ${WORKER_URL} as user=${USERNAME}\n`);

const started = new Date().toISOString();
const results: UrlResult[] = [];

for (const url of sites) {
  process.stderr.write(`  ${url} … `);
  const r = await runUrl(url);
  const a = r.samples.aicorn;
  const td = r.samples.turndown;
  process.stderr.write(
    `aicorn=${a.ok ? `${fmt(a.tokens)}t` : `✗${a.status}`} · turndown=${td.ok ? `${fmt(td.tokens)}t` : `✗`}\n`,
  );
  results.push(r);
  if (DELAY_MS > 0) await new Promise((res) => setTimeout(res, DELAY_MS));
}

const finished = new Date().toISOString();
const report: Report = {
  started_at: started,
  finished_at: finished,
  worker_url: WORKER_URL,
  username: USERNAME,
  input_price_per_million_usd: PRICE_PER_M_INPUT_USD,
  results,
};

const { json, md } = writeReports(report, RESULTS_DIR);
console.error(`\nReports:`);
console.error(`  ${json}`);
console.error(`  ${md}`);
