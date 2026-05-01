import { Env, json, readJson } from "./env";

export const SIGNUP_GRANT = 100;
export const READ_COST = 10;
export const CONTRIBUTOR_REWARD = 9;

type ChargeResult =
  | { ok: true; new_balance: number }
  | { ok: false; status: number; error: string; balance?: number };

type CreditResult =
  | { ok: true; new_balance: number }
  | { ok: false; status: number; error: string };

export async function chargeUser(
  env: Env,
  userId: string,
  amount: number,
  reason?: string,
): Promise<ChargeResult> {
  const user = await env.DB.prepare("SELECT balance FROM users WHERE id = ?")
    .bind(userId)
    .first<{ balance: number }>();
  if (!user) return { ok: false, status: 404, error: "user_not_found" };
  if (user.balance < amount) {
    return { ok: false, status: 402, error: "insufficient", balance: user.balance };
  }

  const newBalance = user.balance - amount;
  const now = Date.now();

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET balance = ? WHERE id = ?").bind(newBalance, userId),
    env.DB.prepare(
      "INSERT INTO activity (user_id, type, amount, reason, balance_after, created_at) VALUES (?, 'charge', ?, ?, ?, ?)",
    ).bind(userId, amount, reason ?? null, newBalance, now),
    env.DB.prepare("UPDATE stats SET value = value + 1 WHERE key = 'reads'"),
  ]);

  return { ok: true, new_balance: newBalance };
}

export async function creditUser(
  env: Env,
  userId: string,
  amount: number,
  url: string,
): Promise<CreditResult> {
  const user = await env.DB.prepare("SELECT balance FROM users WHERE id = ?")
    .bind(userId)
    .first<{ balance: number }>();
  if (!user) return { ok: false, status: 404, error: "user_not_found" };

  const newBalance = user.balance + amount;
  const now = Date.now();

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET balance = ? WHERE id = ?").bind(newBalance, userId),
    env.DB.prepare(
      "INSERT INTO activity (user_id, type, amount, url, balance_after, created_at) VALUES (?, 'credit', ?, ?, ?, ?)",
    ).bind(userId, amount, url, newBalance, now),
    env.DB.prepare(
      "INSERT INTO contributions (user_id, url, earned, hit_count) VALUES (?, ?, ?, 1) " +
        "ON CONFLICT(user_id, url) DO UPDATE SET earned = earned + excluded.earned, hit_count = hit_count + 1",
    ).bind(userId, url, amount),
  ]);

  return { ok: true, new_balance: newBalance };
}

export async function ledgerCharge(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ user_id: string; amount: number; reason?: string }>(request);
  if (!body?.user_id || typeof body.amount !== "number" || body.amount < 0) {
    return json({ error: "invalid_request" }, 400);
  }
  const result = await chargeUser(env, body.user_id, body.amount, body.reason);
  if (!result.ok) return json({ error: result.error, balance: result.balance }, result.status);
  return json({ ok: true, new_balance: result.new_balance });
}

export async function ledgerCredit(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ user_id: string; amount: number; url: string }>(request);
  if (!body?.user_id || typeof body.amount !== "number" || body.amount < 0 || !body.url) {
    return json({ error: "invalid_request" }, 400);
  }
  const result = await creditUser(env, body.user_id, body.amount, body.url);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ ok: true, new_balance: result.new_balance });
}

export async function getLedger(userId: string, env: Env): Promise<Response> {
  const user = await env.DB.prepare("SELECT balance FROM users WHERE id = ?")
    .bind(userId)
    .first<{ balance: number }>();
  if (!user) return json({ error: "user_not_found" }, 404);

  const contributions = await env.DB.prepare(
    "SELECT url, earned, hit_count FROM contributions WHERE user_id = ? ORDER BY earned DESC",
  )
    .bind(userId)
    .all<{ url: string; earned: number; hit_count: number }>();

  const reads = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM activity WHERE user_id = ? AND type = 'charge'",
  )
    .bind(userId)
    .first<{ c: number }>();

  return json({
    balance: user.balance,
    contributions: contributions.results,
    reads: reads?.c ?? 0,
  });
}
