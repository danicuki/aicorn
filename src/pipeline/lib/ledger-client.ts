import type { Hono } from "hono";
import type { Env } from "../env";

export type ChargeResult = { ok: true; new_balance: number } | { ok: false; error: string };

export async function callCharge(
  app: Hono<{ Bindings: Env }>,
  env: Env,
  user_id: string,
  amount: number,
  reason: string,
): Promise<ChargeResult> {
  const res = await app.fetch(
    new Request("http://internal/ledger/charge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id, amount, reason }),
    }),
    env,
  );
  if (!res.ok) return { ok: false, error: `ledger ${res.status}` };
  const body = (await res.json()) as { ok: boolean; new_balance?: number; error?: string };
  if (!body.ok) return { ok: false, error: body.error ?? "unknown" };
  return { ok: true, new_balance: body.new_balance ?? 0 };
}

export async function callCredit(
  app: Hono<{ Bindings: Env }>,
  env: Env,
  user_id: string,
  amount: number,
  url: string,
): Promise<void> {
  await app.fetch(
    new Request("http://internal/ledger/credit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id, amount, url }),
    }),
    env,
  );
  // Credit failure is non-fatal — log, don't throw.
}
