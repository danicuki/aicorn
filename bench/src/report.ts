import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Report, Sample, UrlResult } from "./types";

export function writeReports(report: Report, outDir: string): { json: string; md: string } {
  mkdirSync(outDir, { recursive: true });
  const stamp = report.started_at.replace(/[:.]/g, "-");
  const jsonPath = join(outDir, `${stamp}.json`);
  const mdPath = join(outDir, `${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, renderMarkdown(report));
  return { json: jsonPath, md: mdPath };
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtUsd(n: number): string {
  if (n < 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

function fmtPct(num: number, denom: number): string {
  if (denom <= 0) return "—";
  const pct = ((denom - num) / denom) * 100;
  return `${pct >= 0 ? "−" : "+"}${Math.abs(pct).toFixed(0)}%`;
}

function statusGlyph(s: Sample): string {
  if (!s.ok) return "✗";
  return "";
}

function renderMarkdown(r: Report): string {
  const lines: string[] = [];
  lines.push(`# Aicorn benchmark · ${r.started_at}`);
  lines.push("");
  lines.push(`Comparing how many input tokens a Claude consumer would pay for, per URL, across three "what they receive" pipes:`);
  lines.push("");
  lines.push(`- **aicorn** — \`GET ${r.worker_url}/fetch?url=…&user=${r.username}\` returns clean markdown via Workers AI extraction.`);
  lines.push(`- **raw_html** — naive: feed the unprocessed HTML straight in.`);
  lines.push(`- **turndown** — realistic baseline: pull HTML, run \`turndown\` for HTML→markdown.`);
  lines.push("");
  lines.push(`Tokens estimated as \`chars / 4\` (same heuristic both sides — ratios are honest, absolutes are approximate). Priced at $${r.input_price_per_million_usd.toFixed(2)}/M input tokens (Claude Sonnet 4.6).`);
  lines.push("");
  lines.push(`## Per URL`);
  lines.push("");
  lines.push(`| URL | aicorn | raw_html | turndown(html) | tokens vs raw | tokens vs turndown |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const u of r.results) {
    const a = u.samples.aicorn;
    const raw = u.samples.raw_html;
    const td = u.samples.turndown;
    const url = u.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    lines.push(
      `| \`${url}\` | ${fmtTokens(a.tokens)}t · ${fmtUsd(a.cost_usd)} ${statusGlyph(a)} | ${fmtTokens(raw.tokens)}t · ${fmtUsd(raw.cost_usd)} ${statusGlyph(raw)} | ${fmtTokens(td.tokens)}t · ${fmtUsd(td.cost_usd)} ${statusGlyph(td)} | **${fmtPct(a.tokens, raw.tokens)}** | **${fmtPct(a.tokens, td.tokens)}** |`,
    );
  }
  lines.push("");

  // Aggregate, only over rows where every pipe succeeded.
  const fair = r.results.filter((u) => u.samples.aicorn.ok && u.samples.raw_html.ok && u.samples.turndown.ok);
  const sum = (sel: (u: UrlResult) => number) => fair.reduce((a, u) => a + sel(u), 0);

  if (fair.length > 0) {
    const aT = sum((u) => u.samples.aicorn.tokens);
    const rT = sum((u) => u.samples.raw_html.tokens);
    const tT = sum((u) => u.samples.turndown.tokens);
    const aC = sum((u) => u.samples.aicorn.cost_usd);
    const rC = sum((u) => u.samples.raw_html.cost_usd);
    const tC = sum((u) => u.samples.turndown.cost_usd);

    lines.push(`## Aggregate (${fair.length}/${r.results.length} URLs where all 3 pipes succeeded)`);
    lines.push("");
    lines.push(`|  | tokens | cost | vs aicorn |`);
    lines.push(`|---|---|---|---|`);
    lines.push(`| **aicorn**   | ${fmtTokens(aT)} | ${fmtUsd(aC)} | — |`);
    lines.push(`| **turndown** | ${fmtTokens(tT)} | ${fmtUsd(tC)} | aicorn ${fmtPct(aT, tT)} |`);
    lines.push(`| **raw_html** | ${fmtTokens(rT)} | ${fmtUsd(rC)} | aicorn ${fmtPct(aT, rT)} |`);
    lines.push("");
  }

  // Failures section.
  const failures: string[] = [];
  for (const u of r.results) {
    for (const pipe of ["aicorn", "raw_html", "turndown"] as const) {
      const s = u.samples[pipe];
      if (!s.ok) failures.push(`- \`${u.url}\` · ${pipe} · ${s.status} · ${s.error ?? "(no error)"}`);
    }
  }
  if (failures.length > 0) {
    lines.push(`## Failures`);
    lines.push("");
    lines.push(...failures);
    lines.push("");
  }

  lines.push(`*Run finished ${r.finished_at}.*`);
  return lines.join("\n");
}
