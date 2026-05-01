# Aicorn Benchmark Suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure the impact of routing Claude's `WebFetch` through the agentify cache. Run the same set of URL+prompt tasks twice — once with the `aicorn` plugin enabled, once without — and compare:

- Wall-clock latency per task
- Token usage (input / output / cache_read) and `$` cost
- Whether the `aicorn:fetch` skill actually triggered (skill picked vs. raw `WebFetch`)
- Answer correctness via keyword recall against an expected-substring list

The plugin's value proposition is "cleaner markdown, fewer tokens, faster on cache hits." This benchmark turns that claim into numbers we can put in a README.

**Architecture:** Standalone Node script in `bench/`. Drives Claude programmatically via `@anthropic-ai/claude-agent-sdk` (TS). Two `settings.json` files toggle the plugin on/off. Sites + per-site prompts + expected keywords live in a JSONL file. Each task runs serially within a config (to avoid agentify rate limits and to keep latency comparable). Results → one JSON file with raw per-task data + one markdown summary table.

**Tech stack:** TypeScript, Node 20+, `@anthropic-ai/claude-agent-sdk`, `tsx` (no compile step), zero new runtime deps beyond the SDK.

**Toggle mechanics (locked):** Two SDK runs, each with a different `settings.json`. The "with-aicorn" settings adds `aicorn` to `enabledPlugins` and points `extraKnownMarketplaces` at the local repo. The "without" settings has neither. **No skill code changes required.**

**Lane contract (locked, do not change):**

- Sites file: `bench/sites.jsonl`, one task per line: `{ "url": string, "prompt": string, "expect": string[] }`.
- Per-task SDK invocation: a single `query({ prompt, options })` call with `permissionMode: "default"` and one user message. We rely on Claude's existing system behaviour to use `WebFetch` for fetch-shaped prompts.
- Result schema: `bench/results/<ISO-timestamp>.json` containing `{ runs: { with: TaskResult[], without: TaskResult[] }, env, started_at, finished_at }`.
- Skill-trigger detection: parse the run transcript; if any tool-use block has `name === "WebFetch"` and the `url` arg starts with the configured agentify Worker URL → `skill_triggered: true`. Otherwise false.

---

## File Structure

```
bench/
├── package.json
├── tsconfig.json
├── README.md
├── .gitignore                      # excludes results/
├── sites.jsonl                     # default site set (5–8 URLs covering edge cases)
├── settings/
│   ├── with-aicorn.json            # enabledPlugins + extraKnownMarketplaces
│   └── without.json                # bare settings (no plugins)
├── src/
│   ├── run.ts                      # entrypoint: parse args, run both configs, emit reports
│   ├── runner.ts                   # drives ONE task: spawns SDK query, captures metrics
│   ├── sites.ts                    # JSONL parser + validation
│   ├── grader.ts                   # keyword-recall scoring of final assistant answer
│   ├── reporter.ts                 # writes JSON + markdown summary
│   └── types.ts                    # TaskInput, TaskResult, RunReport
└── results/                        # gitignored — created per run
    ├── 2026-05-01T18-00-00Z.json
    └── 2026-05-01T18-00-00Z.md
```

**Note on placement:** `bench/` is a sibling to `plugin/`, `src/`, `ledger/`. It's its own npm subproject (own `package.json`) so the SDK install doesn't pollute the Worker's deps.

---

## Task 1: Scaffold `bench/` subproject

**Files:**
- Create: `bench/package.json`
- Create: `bench/tsconfig.json`
- Create: `bench/.gitignore`
- Create: `bench/README.md`

- [ ] **Step 1: `bench/package.json`**

```json
{
  "name": "aicorn-bench",
  "private": true,
  "type": "module",
  "scripts": {
    "bench": "tsx src/run.ts",
    "bench:with": "tsx src/run.ts --only with",
    "bench:without": "tsx src/run.ts --only without"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0"
  },
  "devDependencies": {
    "tsx": "^4.20.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0"
  }
}
```

(Pin `@anthropic-ai/claude-agent-sdk` to whatever the latest published minor is at install time. The fetched docs at implementation time will tell you the current `query` import path and option shape.)

- [ ] **Step 2: `bench/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: `bench/.gitignore`**

```
results/
node_modules/
*.log
```

- [ ] **Step 4: `bench/README.md` skeleton**

Sections: "What it does", "Setup", "Run", "Output". One paragraph each. Add the actual run command examples after Task 7.

- [ ] **Step 5: Install + commit**

```bash
cd bench && npm install
git add bench/package.json bench/package-lock.json bench/tsconfig.json bench/.gitignore bench/README.md
git commit -m "chore(bench): scaffold benchmark subproject"
```

---

## Task 2: Sites file + types

**Files:**
- Create: `bench/sites.jsonl`
- Create: `bench/src/types.ts`
- Create: `bench/src/sites.ts`

- [ ] **Step 1: Choose a representative site set in `bench/sites.jsonl`**

Aim for 5–8 URLs spanning failure modes. One per line, JSON object:

```jsonl
{"url":"https://example.com","prompt":"What is this domain used for?","expect":["documentation","examples","permission"]}
{"url":"https://en.wikipedia.org/wiki/Cloudflare","prompt":"In what year was Cloudflare founded and by whom?","expect":["2009","Matthew Prince","Lee Holloway","Michelle Zatlyn"]}
{"url":"https://en.wikipedia.org/wiki/Cache_(computing)","prompt":"Define a cache hit in one sentence.","expect":["cache","data","previously","stored"]}
{"url":"https://developers.cloudflare.com/workers/","prompt":"What runtime do Cloudflare Workers run on?","expect":["V8","JavaScript","WebAssembly"]}
{"url":"https://www.auchan.pt/","prompt":"List two product campaigns currently advertised.","expect":["Beleza","Mobiliário","Primavera","Dodot"]}
{"url":"https://www.agentsday.org/","prompt":"When and where is Agents Day?","expect":["May","2026","Lisbon","Beato"]}
```

The set deliberately mixes:
- Server-rendered pages (Wikipedia, Cloudflare docs, example.com) — both paths handle these well.
- E-commerce (auchan.pt) — heavy markup; agentify should win on tokens.
- JS-rendered SPA (agentsday.org) — agentify currently FAILS this (43 chars after strip); raw WebFetch may also fail. The benchmark will surface that gap.

- [ ] **Step 2: `bench/src/types.ts`**

```ts
export type TaskInput = {
  url: string;
  prompt: string;
  expect: string[];
};

export type ToolUse = {
  name: string;
  input: Record<string, unknown>;
};

export type TaskResult = {
  task: TaskInput;
  config: "with" | "without";
  started_at: string;
  finished_at: string;
  duration_ms: number;
  ok: boolean;
  error?: string;
  final_answer: string | null;
  skill_triggered: boolean;            // true if any WebFetch URL began with worker_url
  tool_calls: ToolUse[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  cost_usd: number;
  keyword_recall: { matched: string[]; missed: string[]; score: number };
};

export type RunReport = {
  started_at: string;
  finished_at: string;
  worker_url: string;
  username: string;
  sites_path: string;
  with: TaskResult[];
  without: TaskResult[];
};
```

- [ ] **Step 3: `bench/src/sites.ts`** — parse + validate sites.jsonl

```ts
import { readFileSync } from "node:fs";
import type { TaskInput } from "./types";

export function loadSites(path: string): TaskInput[] {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  return lines.map((line, i) => {
    const obj = JSON.parse(line);
    if (typeof obj.url !== "string") throw new Error(`sites:${i + 1} missing url`);
    if (typeof obj.prompt !== "string") throw new Error(`sites:${i + 1} missing prompt`);
    if (!Array.isArray(obj.expect)) throw new Error(`sites:${i + 1} missing expect[]`);
    return obj as TaskInput;
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add bench/sites.jsonl bench/src/types.ts bench/src/sites.ts
git commit -m "feat(bench): site corpus + types + JSONL loader"
```

---

## Task 3: Settings files (the toggle)

**Files:**
- Create: `bench/settings/with-aicorn.json`
- Create: `bench/settings/without.json`

- [ ] **Step 1: `bench/settings/with-aicorn.json`**

Settings format mirrors what the SDK accepts as the `settings` option (or what `claude --settings` reads). At implementation time, fetch the current Agent SDK docs to confirm exact key names.

```json
{
  "extraKnownMarketplaces": {
    "aicorn": {
      "source": {
        "type": "github",
        "owner": "telepenin",
        "repo": "aicorn"
      }
    }
  },
  "enabledPlugins": {
    "aicorn@aicorn": true
  },
  "permissions": {
    "allow": [
      "WebFetch",
      "Read",
      "Skill(aicorn:fetch)",
      "Skill(aicorn:setup)"
    ]
  }
}
```

- [ ] **Step 2: `bench/settings/without.json`**

```json
{
  "permissions": {
    "allow": [
      "WebFetch",
      "Read"
    ]
  }
}
```

- [ ] **Step 3: Bench-local config for the fetch skill**

The `aicorn:fetch` skill reads `.claude/aicorn.local.md` from the **bench working directory**. Create `bench/.claude/aicorn.local.md` so the with-aicorn run picks it up:

```markdown
---
worker_url: https://aicorn.mikhailnovikov.workers.dev
username: bench
domains: "*"
---
```

(`username: bench` keeps benchmark traffic separate from regular `nikolay` use in the agentify ledger. Add `bench/.claude/` to `bench/.gitignore` so the username doesn't leak.)

- [ ] **Step 4: Commit**

```bash
git add bench/settings/ bench/.claude/aicorn.local.md bench/.gitignore
git commit -m "chore(bench): settings.json toggle + benchmark-local aicorn config"
```

---

## Task 4: Runner (drives one task through the SDK)

**Files:**
- Create: `bench/src/runner.ts`

The runner: takes a `TaskInput` + a settings path + the worker URL, opens an SDK query session with that settings file, sends one user message (`Read <url> and answer: <prompt>`), iterates the message stream collecting tool calls + final assistant text + usage, then returns a `TaskResult`.

- [ ] **Step 1: Skeleton**

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { TaskInput, TaskResult, ToolUse } from "./types";
import { gradeAnswer } from "./grader";

const PRICE_USD_PER_M_INPUT = 3;       // Sonnet 4.6 input
const PRICE_USD_PER_M_OUTPUT = 15;     // Sonnet 4.6 output
const PRICE_USD_PER_M_CACHE_READ = 0.30;

export async function runTask(opts: {
  task: TaskInput;
  config: "with" | "without";
  settingsPath: string;
  workerUrl: string;
  cwd: string;                     // bench dir for the with-aicorn run, repo root otherwise
}): Promise<TaskResult> {
  const started = new Date();
  const toolCalls: ToolUse[] = [];
  let finalAnswer: string | null = null;
  let usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let ok = false;
  let error: string | undefined;

  try {
    const stream = query({
      prompt: `Read ${opts.task.url} and answer concisely: ${opts.task.prompt}`,
      options: {
        cwd: opts.cwd,
        settingsPath: opts.settingsPath,
        permissionMode: "default",
      },
    });

    for await (const msg of stream) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            toolCalls.push({ name: block.name, input: block.input as Record<string, unknown> });
          }
          if (block.type === "text") {
            finalAnswer = (finalAnswer ?? "") + block.text;
          }
        }
        if (msg.message.usage) {
          usage.input_tokens += msg.message.usage.input_tokens ?? 0;
          usage.output_tokens += msg.message.usage.output_tokens ?? 0;
          usage.cache_read_input_tokens += msg.message.usage.cache_read_input_tokens ?? 0;
          usage.cache_creation_input_tokens += msg.message.usage.cache_creation_input_tokens ?? 0;
        }
      }
      if (msg.type === "result") {
        ok = msg.subtype === "success";
        if (!ok && "error" in msg) error = String((msg as { error: unknown }).error);
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const finished = new Date();
  const skillTriggered = toolCalls.some(
    (c) => c.name === "WebFetch" && typeof c.input.url === "string" && (c.input.url as string).startsWith(opts.workerUrl),
  );
  const cost =
    (usage.input_tokens * PRICE_USD_PER_M_INPUT +
      usage.output_tokens * PRICE_USD_PER_M_OUTPUT +
      usage.cache_read_input_tokens * PRICE_USD_PER_M_CACHE_READ) / 1_000_000;

  return {
    task: opts.task,
    config: opts.config,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_ms: finished.getTime() - started.getTime(),
    ok,
    error,
    final_answer: finalAnswer,
    skill_triggered: skillTriggered,
    tool_calls: toolCalls,
    usage,
    cost_usd: cost,
    keyword_recall: gradeAnswer(finalAnswer ?? "", opts.task.expect),
  };
}
```

- [ ] **Step 2: Verify the SDK API shape at implementation time**

The Agent SDK's exact import path, message type names, and option keys may have moved. Before writing this file, fetch the current docs:

```bash
# at implementation time
curl -s "https://docs.claude.com/en/api/agent-sdk/typescript" | head -200
```

Or use the `claude-code-guide` skill for canonical examples. The skeleton above reflects v0.x conventions; adjust as needed.

- [ ] **Step 3: Commit**

```bash
git add bench/src/runner.ts
git commit -m "feat(bench): runner — drives one task through Claude Agent SDK"
```

---

## Task 5: Grader (keyword recall)

**Files:**
- Create: `bench/src/grader.ts`

Crude but useful: count how many `expect[]` substrings appear (case-insensitive) in the final answer. Score = matched / expect.length.

- [ ] **Step 1: `bench/src/grader.ts`**

```ts
export function gradeAnswer(
  answer: string,
  expect: string[],
): { matched: string[]; missed: string[]; score: number } {
  const lower = answer.toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];
  for (const k of expect) {
    if (lower.includes(k.toLowerCase())) matched.push(k);
    else missed.push(k);
  }
  return {
    matched,
    missed,
    score: expect.length === 0 ? 1 : matched.length / expect.length,
  };
}
```

- [ ] **Step 2: Quick sanity check via `tsx -e`**

```bash
cd bench
npx tsx -e 'import("./src/grader.ts").then(m => console.log(m.gradeAnswer("Cloudflare was founded in 2009 by Matthew Prince.", ["2009","Matthew Prince","Lee Holloway"])))'
```

Expected: `{ matched: ['2009','Matthew Prince'], missed: ['Lee Holloway'], score: 0.66... }`

- [ ] **Step 3: Commit**

```bash
git add bench/src/grader.ts
git commit -m "feat(bench): keyword-recall grader"
```

---

## Task 6: Reporter (JSON + markdown)

**Files:**
- Create: `bench/src/reporter.ts`

- [ ] **Step 1: `bench/src/reporter.ts`**

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunReport, TaskResult } from "./types";

export function writeReports(report: RunReport, outDir: string): { json: string; md: string } {
  mkdirSync(outDir, { recursive: true });
  const stamp = report.started_at.replace(/[:.]/g, "-");
  const jsonPath = join(outDir, `${stamp}.json`);
  const mdPath = join(outDir, `${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, renderMarkdown(report));
  return { json: jsonPath, md: mdPath };
}

function renderMarkdown(r: RunReport): string {
  const lines: string[] = [];
  lines.push(`# Aicorn benchmark · ${r.started_at}`);
  lines.push("");
  lines.push(`- worker: \`${r.worker_url}\``);
  lines.push(`- username: \`${r.username}\``);
  lines.push(`- sites: \`${r.sites_path}\` (${r.with.length} tasks)`);
  lines.push("");
  lines.push("## Per-task comparison");
  lines.push("");
  lines.push("| URL | with: lat | with: tok | with: $ | with: skill✓ | with: recall | without: lat | without: tok | without: $ | without: recall |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (let i = 0; i < r.with.length; i++) {
    const w = r.with[i]!;
    const wo = r.without[i]!;
    const url = w.task.url.replace(/^https?:\/\//, "");
    lines.push(
      `| \`${url}\` | ${w.duration_ms}ms | ${w.usage.input_tokens + w.usage.output_tokens} | $${w.cost_usd.toFixed(4)} | ${w.skill_triggered ? "✓" : "✗"} | ${(w.keyword_recall.score * 100).toFixed(0)}% | ${wo.duration_ms}ms | ${wo.usage.input_tokens + wo.usage.output_tokens} | $${wo.cost_usd.toFixed(4)} | ${(wo.keyword_recall.score * 100).toFixed(0)}% |`,
    );
  }
  lines.push("");
  lines.push("## Aggregate");
  lines.push("");
  const sumW = aggregate(r.with);
  const sumWo = aggregate(r.without);
  lines.push(`- **with aicorn**:    ${sumW.tokens} tokens, ${sumW.duration_ms}ms wall, $${sumW.cost.toFixed(4)}, ${sumW.recall.toFixed(0)}% recall, skill triggered ${sumW.triggered}/${r.with.length}`);
  lines.push(`- **without aicorn**: ${sumWo.tokens} tokens, ${sumWo.duration_ms}ms wall, $${sumWo.cost.toFixed(4)}, ${sumWo.recall.toFixed(0)}% recall`);
  lines.push("");
  lines.push(`**Token delta**: ${sumW.tokens - sumWo.tokens} (negative = aicorn cheaper)`);
  lines.push(`**Latency delta**: ${sumW.duration_ms - sumWo.duration_ms}ms`);
  lines.push(`**Cost delta**: $${(sumW.cost - sumWo.cost).toFixed(4)}`);
  return lines.join("\n");
}

function aggregate(rs: TaskResult[]) {
  return {
    tokens: rs.reduce((a, r) => a + r.usage.input_tokens + r.usage.output_tokens, 0),
    duration_ms: rs.reduce((a, r) => a + r.duration_ms, 0),
    cost: rs.reduce((a, r) => a + r.cost_usd, 0),
    recall: (rs.reduce((a, r) => a + r.keyword_recall.score, 0) / rs.length) * 100,
    triggered: rs.filter((r) => r.skill_triggered).length,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add bench/src/reporter.ts
git commit -m "feat(bench): JSON + markdown reporter"
```

---

## Task 7: Entrypoint (`run.ts`) + npm scripts

**Files:**
- Create: `bench/src/run.ts`

- [ ] **Step 1: `bench/src/run.ts`** — orchestrate both runs serially

```ts
import { resolve } from "node:path";
import { runTask } from "./runner";
import { loadSites } from "./sites";
import { writeReports } from "./reporter";
import type { RunReport, TaskResult } from "./types";

const WORKER_URL = "https://aicorn.mikhailnovikov.workers.dev";
const USERNAME = "bench";
const ROOT = resolve(import.meta.dirname, "..");
const SITES_PATH = resolve(ROOT, "sites.jsonl");
const RESULTS_DIR = resolve(ROOT, "results");

async function runConfig(
  config: "with" | "without",
  sites: import("./types").TaskInput[],
): Promise<TaskResult[]> {
  const settingsPath = resolve(ROOT, `settings/${config === "with" ? "with-aicorn" : "without"}.json`);
  const cwd = config === "with" ? ROOT : resolve(ROOT, "..");
  const out: TaskResult[] = [];
  for (const task of sites) {
    process.stderr.write(`[${config}] ${task.url} … `);
    const r = await runTask({ task, config, settingsPath, workerUrl: WORKER_URL, cwd });
    process.stderr.write(`${r.duration_ms}ms · ${r.usage.input_tokens + r.usage.output_tokens}tok · recall=${(r.keyword_recall.score * 100).toFixed(0)}%${r.skill_triggered ? " · skill✓" : ""}\n`);
    out.push(r);
    // small breather between requests so agentify rate limits don't bite
    await new Promise((res) => setTimeout(res, 1500));
  }
  return out;
}

const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1] as "with" | "without" | undefined;

const sites = loadSites(SITES_PATH);
const started = new Date().toISOString();

const withRun = onlyArg !== "without" ? await runConfig("with", sites) : [];
const withoutRun = onlyArg !== "with" ? await runConfig("without", sites) : [];

const finished = new Date().toISOString();
const report: RunReport = {
  started_at: started,
  finished_at: finished,
  worker_url: WORKER_URL,
  username: USERNAME,
  sites_path: SITES_PATH,
  with: withRun,
  without: withoutRun,
};

const { json, md } = writeReports(report, RESULTS_DIR);
console.log(`\nReports: ${json}\n         ${md}`);
```

- [ ] **Step 2: Test the harness compiles**

```bash
cd bench
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add bench/src/run.ts
git commit -m "feat(bench): orchestrator entrypoint with --only flag"
```

---

## Task 8: First end-to-end run

**Files:** None.

- [ ] **Step 1: Top up the `bench` user's agentify balance**

The aicorn run will call agentify as `user=bench`, charging it for each fetch. Use Mikhail's ledger admin to seed the balance (or pick a username that already has credit).

```bash
# adjust to whatever Mikhail's admin route looks like
curl -X POST "$WORKER_URL/admin/credit" -d '{"user_id":"bench","amount":10000}'
```

- [ ] **Step 2: Run the full benchmark**

```bash
cd bench
npm run bench
```

Expected output:
- `bench/results/<timestamp>.json` — raw per-task data
- `bench/results/<timestamp>.md` — human summary

- [ ] **Step 3: Inspect**

Open the markdown report. Check:
- Both configs returned answers (`ok: true`).
- `skill_triggered` is `true` for the with-aicorn run on most rows (allowlist `*` should route everything).
- Token numbers differ — large pages should show meaningful savings on the with-aicorn side.
- Recall scores are within ~10% of each other (similar answer quality).
- The agentsday.org row likely has poor recall on BOTH sides because of the JS-rendering issue. That's the value of running the benchmark — it surfaces where agentify currently underperforms.

- [ ] **Step 4: Commit the first-run results**

```bash
# results/ is gitignored, so screenshot the markdown into the README instead
# or, optionally:
git add -f bench/results/<timestamp>.md
git commit -m "docs(bench): first benchmark run, baseline numbers"
```

---

## Task 9 (optional): CI integration

If we want to track regressions over time, add a GitHub Action that runs the benchmark on a cron + posts the markdown report as a PR comment or commits to `bench/history/`. Out of scope for v1 — just noted here.

---

## Failure modes to handle gracefully

| Failure | Detection | Response |
|---|---|---|
| Agentify Worker down/timeout | `query()` throws or returns `error` result | Mark task `ok: false`, capture error, continue with next task |
| `bench` user out of credits (402) | aicorn skill hits 402, falls back to direct WebFetch (already implemented) | `skill_triggered: false` for that task; benchmark still measures something useful |
| WebFetch blocked by CSP/robots | tool returns error message in body | Recall score ~0 for both configs, latency still recorded |
| SDK API drift between plan & implementation | type errors or runtime crashes | Refer to current Agent SDK docs at implementation time; key shapes (`message.usage`, `tool_use` block) are stable, top-level imports may have moved |

---

## Out of scope (explicit non-goals)

- **Statistical rigour**: single-shot per task; no warmup, no median-of-N. The point is order-of-magnitude differences, not p-values.
- **Cost of the benchmark itself**: each `query()` consumes Anthropic API tokens. For 6 sites × 2 configs that's ~12 query sessions ≈ a few cents. Not worth optimizing.
- **Comparing across models**: the SDK uses whatever `ANTHROPIC_MODEL` is set to (or default). If you want to A/B Sonnet 4.6 vs. Opus 4.7, run twice with the env var changed.
- **Running the agentify Worker locally**: bench points at the deployed Worker. Local would be faster but introduces a deploy step in the bench workflow. Skip.

---

## Appendix: Why the with/without split is fair

Concerns that come up:

1. **"With-aicorn benefits from KV cache state from prior runs."** True. To make a clean cold-vs-cold comparison, append a junk query parameter (`?_bench_${Date.now()}=1`) to every URL in the runner so each task forces a MISS. Optional v2 feature; v1 deliberately rewards prior cache state because that's the realistic deployment.

2. **"With-aicorn includes the skill body in the system prompt, costing extra tokens."** Real but small (~700 tokens for the SKILL.md once per session). The benchmark captures this in the input_tokens column — it's part of the cost.

3. **"Same Claude model and same prompt is enough for fair comparison."** Yes, that's the design.
