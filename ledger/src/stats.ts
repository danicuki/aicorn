import { Env, json, readJson } from "./env";

const VALID_KEYS = ["tokens_saved", "reads", "hits", "misses"] as const;
type StatKey = (typeof VALID_KEYS)[number];

export async function getStats(env: Env): Promise<Response> {
  const rows = await env.DB.prepare("SELECT key, value FROM stats").all<{
    key: string;
    value: number;
  }>();
  const stats: Record<string, number> = Object.fromEntries(
    rows.results.map((r) => [r.key, r.value]),
  );

  const total = (stats.hits ?? 0) + (stats.misses ?? 0);
  const hit_rate = total === 0 ? 0 : stats.hits / total;

  const top = await env.DB.prepare(
    "SELECT user_id, SUM(earned) AS total_earned FROM contributions GROUP BY user_id ORDER BY total_earned DESC LIMIT 5",
  ).all<{ user_id: string; total_earned: number }>();

  return json({
    tokens_saved: stats.tokens_saved ?? 0,
    reads: stats.reads ?? 0,
    hits: stats.hits ?? 0,
    misses: stats.misses ?? 0,
    hit_rate,
    top_contributors: top.results,
  });
}

export async function incrStat(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ key: StatKey; by?: number }>(request);
  if (!body?.key || !VALID_KEYS.includes(body.key)) {
    return json({ error: "invalid_key" }, 400);
  }
  const by = body.by ?? 1;
  await env.DB.prepare("UPDATE stats SET value = value + ? WHERE key = ?")
    .bind(by, body.key)
    .run();
  return json({ ok: true });
}
