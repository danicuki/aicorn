import { Env, json, readJson } from "./env";
import { SIGNUP_GRANT } from "./ledger";

const READ_COST = 10;
const CONTRIBUTOR_REWARD = 9;

interface AccessBody {
  user_name: string;
  accessed_url: string;
  extraction_cost?: number;
}

interface UserRow {
  id: string;
  name: string | null;
  balance: number;
}

export async function ledgerAccess(request: Request, env: Env): Promise<Response> {
  const body = await readJson<AccessBody>(request);
  if (!body?.user_name || !body?.accessed_url) {
    return json({ error: "invalid_request" }, 400);
  }
  const url = body.accessed_url;
  const userName = body.user_name.trim();
  if (!userName) return json({ error: "invalid_request" }, 400);

  let requester = await env.DB.prepare(
    "SELECT id, name, balance FROM users WHERE name = ? LIMIT 1",
  )
    .bind(userName)
    .first<UserRow>();

  let userCreated = false;
  if (!requester) {
    const newId = crypto.randomUUID();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, name, balance, created_at) VALUES (?, ?, ?, ?)",
      ).bind(newId, userName, SIGNUP_GRANT, now),
      env.DB.prepare(
        "INSERT INTO activity (user_id, type, amount, reason, balance_after, created_at) VALUES (?, 'signup', ?, 'signup_grant', ?, ?)",
      ).bind(newId, SIGNUP_GRANT, SIGNUP_GRANT, now),
    ]);
    requester = { id: newId, name: userName, balance: SIGNUP_GRANT };
    userCreated = true;
  }

  const contributor = await env.DB.prepare(
    "SELECT u.id AS id, u.name AS name, u.balance AS balance " +
      "FROM contributions c JOIN users u ON u.id = c.user_id " +
      "WHERE c.url = ? LIMIT 1",
  )
    .bind(url)
    .first<UserRow>();

  // Branch 1: register caller as the first fetcher / contributor.
  if (
    body.extraction_cost !== undefined &&
    body.extraction_cost !== null &&
    !contributor
  ) {
    if (typeof body.extraction_cost !== "number" || body.extraction_cost < 0) {
      return json({ error: "invalid_extraction_cost" }, 400);
    }
    if (requester.balance < body.extraction_cost) {
      return json({ error: "insufficient", balance: requester.balance }, 402);
    }

    const newBalance = requester.balance - body.extraction_cost;
    const now = Date.now();

    await env.DB.batch([
      env.DB.prepare("UPDATE users SET balance = ? WHERE id = ?").bind(
        newBalance,
        requester.id,
      ),
      env.DB.prepare(
        "INSERT INTO activity (user_id, type, amount, reason, url, balance_after, created_at) VALUES (?, 'charge', ?, ?, ?, ?, ?)",
      ).bind(
        requester.id,
        body.extraction_cost,
        "processed url " + url,
        url,
        newBalance,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO contributions (user_id, url, earned, hit_count) VALUES (?, ?, 0, 0)",
      ).bind(requester.id, url),
      env.DB.prepare("UPDATE stats SET value = value + 1 WHERE key = 'reads'"),
      env.DB.prepare("UPDATE stats SET value = value + 1 WHERE key = 'misses'"),
    ]);

    return json({
      requesting_user: {
        name: requester.name ?? requester.id,
        spent: body.extraction_cost,
      },
      providing_user: null,
      user_created: userCreated,
    });
  }

  // Branch 2: cache-hit read flow. Charge requester 10, credit contributor 9.
  if (!contributor) {
    return json(
      {
        error: "url_not_processed",
        message:
          "URL has not been processed yet; include extraction_cost to register as the first fetcher",
      },
      404,
    );
  }

  if (requester.balance < READ_COST) {
    return json({ error: "insufficient", balance: requester.balance }, 402);
  }

  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];

  if (requester.id === contributor.id) {
    const balanceAfterCharge = requester.balance - READ_COST;
    const finalBalance = balanceAfterCharge + CONTRIBUTOR_REWARD;
    stmts.push(
      env.DB.prepare("UPDATE users SET balance = ? WHERE id = ?").bind(
        finalBalance,
        requester.id,
      ),
      env.DB.prepare(
        "INSERT INTO activity (user_id, type, amount, reason, url, balance_after, created_at) VALUES (?, 'charge', ?, ?, ?, ?, ?)",
      ).bind(
        requester.id,
        READ_COST,
        "accessed url " + url,
        url,
        balanceAfterCharge,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO activity (user_id, type, amount, reason, url, balance_after, created_at) VALUES (?, 'credit', ?, ?, ?, ?, ?)",
      ).bind(
        requester.id,
        CONTRIBUTOR_REWARD,
        "someone reused url " + url,
        url,
        finalBalance,
        now,
      ),
    );
  } else {
    const requesterNewBalance = requester.balance - READ_COST;
    const contributorNewBalance = contributor.balance + CONTRIBUTOR_REWARD;
    stmts.push(
      env.DB.prepare("UPDATE users SET balance = ? WHERE id = ?").bind(
        requesterNewBalance,
        requester.id,
      ),
      env.DB.prepare(
        "INSERT INTO activity (user_id, type, amount, reason, url, balance_after, created_at) VALUES (?, 'charge', ?, ?, ?, ?, ?)",
      ).bind(
        requester.id,
        READ_COST,
        "accessed url " + url,
        url,
        requesterNewBalance,
        now,
      ),
      env.DB.prepare("UPDATE users SET balance = ? WHERE id = ?").bind(
        contributorNewBalance,
        contributor.id,
      ),
      env.DB.prepare(
        "INSERT INTO activity (user_id, type, amount, reason, url, balance_after, created_at) VALUES (?, 'credit', ?, ?, ?, ?, ?)",
      ).bind(
        contributor.id,
        CONTRIBUTOR_REWARD,
        "someone reused url " + url,
        url,
        contributorNewBalance,
        now,
      ),
    );
  }

  stmts.push(
    env.DB.prepare(
      "UPDATE contributions SET earned = earned + ?, hit_count = hit_count + 1 WHERE user_id = ? AND url = ?",
    ).bind(CONTRIBUTOR_REWARD, contributor.id, url),
    env.DB.prepare("UPDATE stats SET value = value + 1 WHERE key = 'reads'"),
    env.DB.prepare("UPDATE stats SET value = value + 1 WHERE key = 'hits'"),
  );

  await env.DB.batch(stmts);

  return json({
    requesting_user: {
      name: requester.name ?? requester.id,
      spent: READ_COST,
    },
    providing_user: {
      name: contributor.name ?? contributor.id,
      earned: CONTRIBUTOR_REWARD,
    },
    user_created: userCreated,
  });
}
