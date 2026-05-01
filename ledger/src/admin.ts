import { Env, json, html, readJson } from "./env";
import { chargeUser, creditUser, SIGNUP_GRANT } from "./ledger";
import { ADMIN_HTML } from "./admin_html";
import { ACCESS_TESTER_HTML } from "./access_html";

interface UserRow {
  id: string;
  name: string | null;
  balance: number;
  created_at: number;
}

export async function adminHandler(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/admin" && method === "GET") return html(ADMIN_HTML);
  if (pathname === "/admin/access" && method === "GET") return html(ACCESS_TESTER_HTML);

  if (pathname === "/admin/users" && method === "GET") return listUsers(env);
  if (pathname === "/admin/users" && method === "POST") return createUser(request, env);

  if (pathname === "/admin/stats" && method === "PATCH") return patchStats(request, env);

  const userMatch = pathname.match(/^\/admin\/users\/([^/]+)(\/.*)?$/);
  if (userMatch) {
    const userId = decodeURIComponent(userMatch[1]);
    const sub = userMatch[2] ?? "";

    if (sub === "" && method === "GET") return getUserDetail(userId, env);
    if (sub === "" && method === "PATCH") return updateUser(userId, request, env);
    if (sub === "/charge" && method === "POST") return adminCharge(userId, request, env);
    if (sub === "/credit" && method === "POST") return adminCredit(userId, request, env);
  }

  return json({ error: "not_found" }, 404);
}

async function listUsers(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    "SELECT id, name, balance, created_at FROM users ORDER BY created_at DESC",
  ).all<UserRow>();
  return json({ users: rows.results });
}

async function createUser(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ id?: string; name?: string }>(request);
  const id = body?.id?.trim() || crypto.randomUUID();
  const name = body?.name?.trim() || null;
  const now = Date.now();

  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, name, balance, created_at) VALUES (?, ?, ?, ?)",
      ).bind(id, name, SIGNUP_GRANT, now),
      env.DB.prepare(
        "INSERT INTO activity (user_id, type, amount, reason, balance_after, created_at) VALUES (?, 'signup', ?, 'signup_grant', ?, ?)",
      ).bind(id, SIGNUP_GRANT, SIGNUP_GRANT, now),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) return json({ error: "user_exists" }, 409);
    throw e;
  }

  return json({ ok: true, user: { id, name, balance: SIGNUP_GRANT, created_at: now } });
}

async function getUserDetail(userId: string, env: Env): Promise<Response> {
  const user = await env.DB.prepare(
    "SELECT id, name, balance, created_at FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<UserRow>();
  if (!user) return json({ error: "user_not_found" }, 404);

  const activity = await env.DB.prepare(
    "SELECT id, type, amount, reason, url, balance_after, created_at FROM activity WHERE user_id = ? ORDER BY created_at DESC LIMIT 200",
  )
    .bind(userId)
    .all();

  const contributions = await env.DB.prepare(
    "SELECT url, earned, hit_count FROM contributions WHERE user_id = ? ORDER BY earned DESC",
  )
    .bind(userId)
    .all();

  return json({
    user,
    activity: activity.results,
    contributions: contributions.results,
  });
}

async function updateUser(userId: string, request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ name?: string | null; balance?: number }>(request);
  if (!body) return json({ error: "invalid_request" }, 400);

  const user = await env.DB.prepare("SELECT balance FROM users WHERE id = ?")
    .bind(userId)
    .first<{ balance: number }>();
  if (!user) return json({ error: "user_not_found" }, 404);

  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.name !== undefined) {
    sets.push("name = ?");
    params.push(body.name);
  }
  if (body.balance !== undefined) {
    if (typeof body.balance !== "number" || body.balance < 0) {
      return json({ error: "invalid_balance" }, 400);
    }
    sets.push("balance = ?");
    params.push(body.balance);
  }

  if (sets.length === 0) return json({ error: "no_changes" }, 400);

  params.push(userId);
  const stmts = [
    env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...params),
  ];

  if (body.balance !== undefined && body.balance !== user.balance) {
    const delta = body.balance - user.balance;
    stmts.push(
      env.DB.prepare(
        "INSERT INTO activity (user_id, type, amount, reason, balance_after, created_at) VALUES (?, 'admin_adjust', ?, 'admin_set_balance', ?, ?)",
      ).bind(userId, delta, body.balance, Date.now()),
    );
  }

  await env.DB.batch(stmts);
  return json({ ok: true });
}

async function adminCharge(userId: string, request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ amount: number; reason?: string }>(request);
  if (!body || typeof body.amount !== "number" || body.amount < 0) {
    return json({ error: "invalid_request" }, 400);
  }
  const result = await chargeUser(env, userId, body.amount, body.reason ?? "admin_charge");
  if (!result.ok) return json({ error: result.error, balance: result.balance }, result.status);
  return json({ ok: true, new_balance: result.new_balance });
}

const STAT_KEYS = ["tokens_saved", "reads", "hits", "misses"] as const;

async function patchStats(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ key: string; value: number }>(request);
  if (!body?.key || typeof body.value !== "number" || body.value < 0 || !Number.isFinite(body.value)) {
    return json({ error: "invalid_request" }, 400);
  }
  if (!(STAT_KEYS as readonly string[]).includes(body.key)) {
    return json({ error: "invalid_key" }, 400);
  }
  await env.DB.prepare("UPDATE stats SET value = ? WHERE key = ?")
    .bind(Math.floor(body.value), body.key)
    .run();
  return json({ ok: true });
}

async function adminCredit(userId: string, request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ amount: number; url: string }>(request);
  if (!body || typeof body.amount !== "number" || body.amount < 0 || !body.url) {
    return json({ error: "invalid_request" }, 400);
  }
  const result = await creditUser(env, userId, body.amount, body.url);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ ok: true, new_balance: result.new_balance });
}
