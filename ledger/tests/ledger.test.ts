import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { chargeUser, creditUser, SIGNUP_GRANT } from "../src/ledger";

async function seedUser(id: string, name: string, balance: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO users (id, name, balance, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, name, balance, Date.now())
    .run();
}

async function getBalance(id: string): Promise<number | null> {
  const row = await env.DB.prepare("SELECT balance FROM users WHERE id = ?")
    .bind(id)
    .first<{ balance: number }>();
  return row?.balance ?? null;
}

async function activityCount(id: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM activity WHERE user_id = ?",
  )
    .bind(id)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("chargeUser", () => {
  it("debits balance + writes activity row on success", async () => {
    await seedUser("u1", "alice", 100);

    const result = await chargeUser(env, "u1", 30, "test");

    expect(result).toEqual({ ok: true, new_balance: 70 });
    expect(await getBalance("u1")).toBe(70);
    expect(await activityCount("u1")).toBe(1);
  });

  it("returns 402 insufficient + leaves balance unchanged", async () => {
    await seedUser("u1", "alice", 5);

    const result = await chargeUser(env, "u1", 100, "test");

    expect(result).toEqual({
      ok: false,
      status: 402,
      error: "insufficient",
      balance: 5,
    });
    expect(await getBalance("u1")).toBe(5);
    expect(await activityCount("u1")).toBe(0);
  });

  it("returns 404 user_not_found for unknown id", async () => {
    const result = await chargeUser(env, "ghost", 10, "test");

    expect(result).toEqual({ ok: false, status: 404, error: "user_not_found" });
  });

  it("charging exactly the balance leaves user at 0 (boundary)", async () => {
    await seedUser("u1", "alice", 10);

    const result = await chargeUser(env, "u1", 10, "boundary");

    expect(result).toEqual({ ok: true, new_balance: 0 });
    expect(await getBalance("u1")).toBe(0);
  });

  it("two sequential charges decrement balance correctly", async () => {
    await seedUser("u1", "alice", 100);
    await chargeUser(env, "u1", 30, "first");
    await chargeUser(env, "u1", 20, "second");

    expect(await getBalance("u1")).toBe(50);
    expect(await activityCount("u1")).toBe(2);
  });
});

describe("creditUser", () => {
  it("credits balance + writes activity row on success", async () => {
    await seedUser("u1", "alice", 100);

    const result = await creditUser(env, "u1", 25, "https://example.com");

    expect(result).toEqual({ ok: true, new_balance: 125 });
    expect(await getBalance("u1")).toBe(125);
    expect(await activityCount("u1")).toBe(1);
  });

  it("returns 404 user_not_found for unknown id", async () => {
    const result = await creditUser(env, "ghost", 10, "https://example.com");

    expect(result).toEqual({ ok: false, status: 404, error: "user_not_found" });
  });
});

describe("constants", () => {
  it("SIGNUP_GRANT is 5000 (re-exported from ledger.ts)", () => {
    expect(SIGNUP_GRANT).toBe(5000);
  });
});
