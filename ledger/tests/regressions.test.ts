// Regression tests for bugs documented in docs/code-review-2026-05-02.md.
//
// Each test asserts the *desired* behaviour. Tests marked `it.fails` are
// expected to fail until the corresponding bug is fixed — vitest treats them
// as passing while they fail. When the fix lands, flip `it.fails` → `it`
// (vitest will refuse to mark a passing test as expected-failing).
//
// IDs reference the code-review doc. Update STATUS in that doc to "Fixed in
// <sha>" when the bug is closed AND when this marker flips.

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ledgerAccess } from "../src/access";
import { SIGNUP_GRANT } from "../src/ledger";

const READ_COST = 10;

function postAccess(body: {
  user_name: string;
  accessed_url: string;
  extraction_cost?: number;
}): Request {
  return new Request("https://ledger/ledger/access", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getStatValue(key: string): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM stats WHERE key = ?")
    .bind(key)
    .first<{ value: number }>();
  return row?.value ?? 0;
}

async function getContrib(url: string): Promise<{ hit_count: number; earned: number } | null> {
  return env.DB.prepare(
    "SELECT hit_count, earned FROM contributions WHERE url = ?",
  )
    .bind(url)
    .first<{ hit_count: number; earned: number }>();
}

async function getUserByName(name: string) {
  return env.DB.prepare("SELECT id, balance FROM users WHERE name = ?")
    .bind(name)
    .first<{ id: string; balance: number }>();
}

describe("L-I2 — self-read must NOT inflate contributor leaderboard", () => {
  // When the requester is the contributor of the URL they're reading, the net
  // balance change is correctly −1 (charge 10, credit 9). But the
  // contribution row's `earned` should NOT increase — otherwise re-reading
  // your own URL is a leaderboard farm. See access.ts:199-202 (the
  // unconditional `UPDATE contributions SET earned = earned + ?` runs even
  // for self-reads).
  it.fails("does not bump `earned` on contributions when requester == contributor", async () => {
    const URL = "https://example.com";

    // alice contributes the URL
    await ledgerAccess(
      postAccess({ user_name: "alice", accessed_url: URL, extraction_cost: 200 }),
      env,
    );
    expect((await getContrib(URL))?.earned).toBe(0);

    // alice reads her own URL
    await ledgerAccess(postAccess({ user_name: "alice", accessed_url: URL }), env);

    // BUG: earned currently goes to 9. Desired: stays 0 (no self-credit).
    expect((await getContrib(URL))?.earned).toBe(0);
  });

  it("self-read still nets −1 on balance (charge 10 − credit 9)", async () => {
    const URL = "https://example.com";

    await ledgerAccess(
      postAccess({ user_name: "alice", accessed_url: URL, extraction_cost: 200 }),
      env,
    );
    const balanceAfterContribution = (await getUserByName("alice"))?.balance;
    expect(balanceAfterContribution).toBe(SIGNUP_GRANT - 200);

    await ledgerAccess(postAccess({ user_name: "alice", accessed_url: URL }), env);

    // This part already works correctly today.
    expect((await getUserByName("alice"))?.balance).toBe(
      (balanceAfterContribution ?? 0) - 1,
    );
  });
});

describe("L-I3 — tokens_saved must never go negative", () => {
  // Stat is computed as contributor.extraction_cost − READ_COST per HIT.
  // For tiny pages (extraction_cost < 10), this decrements the public counter.
  // See access.ts:209-216 — needs Math.max(0, savings).
  it.fails("does not decrement tokens_saved when extraction_cost < READ_COST", async () => {
    const URL = "https://tiny.example.com";

    // alice contributes a 5-token page
    await ledgerAccess(
      postAccess({ user_name: "alice", accessed_url: URL, extraction_cost: 5 }),
      env,
    );
    expect(await getStatValue("tokens_saved")).toBe(0);

    // bob reads — tokens_saved += (5 − 10) = −5 today. Desired: stays 0.
    await env.DB.prepare(
      "INSERT INTO users (id, name, balance, created_at) VALUES ('bob-id', 'bob', 100, ?)",
    )
      .bind(Date.now())
      .run();
    await ledgerAccess(postAccess({ user_name: "bob", accessed_url: URL }), env);

    expect(await getStatValue("tokens_saved")).toBe(0);
    // Equivalent stronger assertion:
    expect(await getStatValue("tokens_saved")).toBeGreaterThanOrEqual(0);
  });

  it("tokens_saved increments correctly when extraction_cost > READ_COST", async () => {
    const URL = "https://big.example.com";

    await ledgerAccess(
      postAccess({ user_name: "alice", accessed_url: URL, extraction_cost: 1000 }),
      env,
    );
    await env.DB.prepare(
      "INSERT INTO users (id, name, balance, created_at) VALUES ('bob-id', 'bob', 100, ?)",
    )
      .bind(Date.now())
      .run();
    await ledgerAccess(postAccess({ user_name: "bob", accessed_url: URL }), env);

    // 1000 − 10 = 990. This part already works correctly.
    expect(await getStatValue("tokens_saved")).toBe(990);
  });
});

describe("L-I1 — brand-new user with extraction_cost > SIGNUP_GRANT can recover", () => {
  // Today: requesting an extraction with cost > SIGNUP_GRANT for a never-seen
  // user returns 402 + does NOT create the user. The caller can't be topped
  // up because they don't exist; they can't sign up because every retry
  // returns the same 402. See access.ts:46-77.
  //
  // Desired: create the user (and write the signup activity row) before the
  // cost check, so they exist with balance=SIGNUP_GRANT and can be topped up.
  it.fails("creates the user even when initial extraction cost exceeds signup grant", async () => {
    const oversizedCost = SIGNUP_GRANT + 1000;

    const res = await ledgerAccess(
      postAccess({
        user_name: "newcomer",
        accessed_url: "https://huge.example.com",
        extraction_cost: oversizedCost,
      }),
      env,
    );

    expect(res.status).toBe(402);
    // BUG: user is currently NOT created. Desired: user exists with
    // balance = SIGNUP_GRANT so they can be topped up via /admin/users/:id/credit.
    const newcomer = await getUserByName("newcomer");
    expect(newcomer).not.toBeNull();
    expect(newcomer?.balance).toBe(SIGNUP_GRANT);
  });

  it("today's behaviour: returns 402 with balance: SIGNUP_GRANT", async () => {
    // Documenting the current state so flipping the regression test above
    // is the only signal needed when L-I1 lands.
    const res = await ledgerAccess(
      postAccess({
        user_name: "newcomer2",
        accessed_url: "https://huge.example.com",
        extraction_cost: SIGNUP_GRANT + 1,
      }),
      env,
    );

    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string; balance: number };
    expect(body).toEqual({ error: "insufficient", balance: SIGNUP_GRANT });
  });
});
