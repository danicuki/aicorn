import { Hono } from "hono";
import type { Env } from "../env";

export const ledger = new Hono<{ Bindings: Env }>();

// STUB — Mikhail will replace this entire file.
// Always returns ok so /fetch can be developed independently.
ledger.post("/ledger/charge", async (c) => {
  const body = await c.req.json<{ user_id: string; amount: number; reason: string }>();
  return c.json({ ok: true, new_balance: 1000 - body.amount });
});

ledger.post("/ledger/credit", async (c) => {
  const body = await c.req.json<{ user_id: string; amount: number; url: string }>();
  return c.json({ ok: true, new_balance: 1000 + body.amount });
});
