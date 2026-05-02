import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ledgerAccess } from "../src/access";
import { SIGNUP_GRANT } from "../src/ledger";

const READ_COST = 10;
const CONTRIBUTOR_REWARD = 9;

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

async function getUserByName(name: string) {
  return env.DB.prepare("SELECT id, name, balance FROM users WHERE name = ?")
    .bind(name)
    .first<{ id: string; name: string; balance: number }>();
}

async function getStatValue(key: string): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM stats WHERE key = ?")
    .bind(key)
    .first<{ value: number }>();
  return row?.value ?? 0;
}

async function seedContributor(
  userId: string,
  name: string,
  balance: number,
  url: string,
  extractionCost: number,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, name, balance, created_at) VALUES (?, ?, ?, ?)",
    ).bind(userId, name, balance, Date.now()),
    env.DB.prepare(
      "INSERT INTO contributions (user_id, url, earned, hit_count, extraction_cost) VALUES (?, ?, 0, 0, ?)",
    ).bind(userId, url, extractionCost),
  ]);
}

describe("ledgerAccess — input validation", () => {
  it("400 on missing user_name", async () => {
    const res = await ledgerAccess(
      postAccess({ user_name: "", accessed_url: "https://example.com" }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("400 on missing accessed_url", async () => {
    const res = await ledgerAccess(
      postAccess({ user_name: "alice", accessed_url: "" }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("400 on negative extraction_cost", async () => {
    const res = await ledgerAccess(
      postAccess({
        user_name: "alice",
        accessed_url: "https://example.com",
        extraction_cost: -5,
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("ledgerAccess — MISS path (extraction_cost provided, URL not yet known)", () => {
  it("auto-creates the requesting user with SIGNUP_GRANT − cost", async () => {
    const res = await ledgerAccess(
      postAccess({
        user_name: "alice",
        accessed_url: "https://example.com",
        extraction_cost: 200,
      }),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      requesting_user: { name: string; spent: number };
      providing_user: null;
      user_created: boolean;
    };
    expect(body).toEqual({
      requesting_user: { name: "alice", spent: 200 },
      providing_user: null,
      user_created: true,
    });

    const alice = await getUserByName("alice");
    expect(alice?.balance).toBe(SIGNUP_GRANT - 200);
  });

  it("registers the requester as the URL's contributor with extraction_cost", async () => {
    await ledgerAccess(
      postAccess({
        user_name: "alice",
        accessed_url: "https://example.com",
        extraction_cost: 200,
      }),
      env,
    );

    const contrib = await env.DB.prepare(
      "SELECT extraction_cost, hit_count, earned FROM contributions WHERE url = ?",
    )
      .bind("https://example.com")
      .first<{ extraction_cost: number; hit_count: number; earned: number }>();
    expect(contrib).toEqual({ extraction_cost: 200, hit_count: 0, earned: 0 });
  });

  it("increments reads + misses stats", async () => {
    await ledgerAccess(
      postAccess({
        user_name: "alice",
        accessed_url: "https://example.com",
        extraction_cost: 200,
      }),
      env,
    );

    expect(await getStatValue("reads")).toBe(1);
    expect(await getStatValue("misses")).toBe(1);
    expect(await getStatValue("hits")).toBe(0);
  });
});

describe("ledgerAccess — HIT path (URL already has a contributor)", () => {
  const URL = "https://example.com";

  it("charges reader 10 and credits contributor 9 when they're different users", async () => {
    await seedContributor("alice-id", "alice", 100, URL, 200);
    // pre-seed bob with enough balance
    await env.DB.prepare(
      "INSERT INTO users (id, name, balance, created_at) VALUES ('bob-id', 'bob', 50, ?)",
    )
      .bind(Date.now())
      .run();

    const res = await ledgerAccess(
      postAccess({ user_name: "bob", accessed_url: URL }),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      requesting_user: { name: string; spent: number };
      providing_user: { name: string; earned: number };
    };
    expect(body.requesting_user).toEqual({
      name: "bob",
      spent: READ_COST,
    });
    expect(body.providing_user).toEqual({
      name: "alice",
      earned: CONTRIBUTOR_REWARD,
    });

    expect((await getUserByName("bob"))?.balance).toBe(50 - READ_COST);
    expect((await getUserByName("alice"))?.balance).toBe(100 + CONTRIBUTOR_REWARD);
  });

  it("auto-creates a brand-new reader (signup grant minus READ_COST)", async () => {
    await seedContributor("alice-id", "alice", 100, URL, 200);

    const res = await ledgerAccess(
      postAccess({ user_name: "carol", accessed_url: URL }),
      env,
    );

    expect(res.status).toBe(200);
    const carol = await getUserByName("carol");
    expect(carol?.balance).toBe(SIGNUP_GRANT - READ_COST);
  });

  it("increments reads + hits stats (not misses)", async () => {
    await seedContributor("alice-id", "alice", 100, URL, 200);

    await ledgerAccess(postAccess({ user_name: "bob", accessed_url: URL }), env);

    expect(await getStatValue("reads")).toBe(1);
    expect(await getStatValue("hits")).toBe(1);
    expect(await getStatValue("misses")).toBe(0);
  });

  it("bumps the contribution row's hit_count + earned", async () => {
    await seedContributor("alice-id", "alice", 100, URL, 200);

    await ledgerAccess(postAccess({ user_name: "bob", accessed_url: URL }), env);

    const contrib = await env.DB.prepare(
      "SELECT hit_count, earned FROM contributions WHERE url = ?",
    )
      .bind(URL)
      .first<{ hit_count: number; earned: number }>();
    expect(contrib).toEqual({ hit_count: 1, earned: CONTRIBUTOR_REWARD });
  });

  it("returns 402 insufficient when reader balance < READ_COST", async () => {
    await seedContributor("alice-id", "alice", 100, URL, 200);
    await env.DB.prepare(
      "INSERT INTO users (id, name, balance, created_at) VALUES ('poor-id', 'poor', 5, ?)",
    )
      .bind(Date.now())
      .run();

    const res = await ledgerAccess(
      postAccess({ user_name: "poor", accessed_url: URL }),
      env,
    );

    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string; balance: number };
    expect(body.error).toBe("insufficient");
    expect(body.balance).toBe(5);
    // Balance should be unchanged.
    expect((await getUserByName("poor"))?.balance).toBe(5);
  });
});

describe("ledgerAccess — URL not yet processed (no extraction_cost in HIT-shaped request)", () => {
  it("returns 404 url_not_processed when no extraction_cost and no contribution", async () => {
    const res = await ledgerAccess(
      postAccess({ user_name: "alice", accessed_url: "https://nobody.touched.this" }),
      env,
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("url_not_processed");
  });

  it("does NOT auto-create the user when returning url_not_processed", async () => {
    await ledgerAccess(
      postAccess({ user_name: "alice", accessed_url: "https://nobody.touched.this" }),
      env,
    );

    expect(await getUserByName("alice")).toBeNull();
  });
});
