export type AccessResult =
  | {
      ok: true;
      spent: number;
      user_created: boolean;
      provider?: { name: string; earned: number };
    }
  | { ok: false; status: number; error: string; balance?: number };

export async function callAccess(
  ledger: Fetcher,
  user_name: string,
  accessed_url: string,
  extraction_cost?: number,
): Promise<AccessResult> {
  const body: {
    user_name: string;
    accessed_url: string;
    extraction_cost?: number;
  } = { user_name, accessed_url };
  if (extraction_cost !== undefined) body.extraction_cost = extraction_cost;

  let res: Response;
  try {
    // Service binding: the URL host is ignored by Cloudflare's runtime,
    // but a syntactically-valid URL is still required.
    res = await ledger.fetch("https://ledger/ledger/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: `ledger_unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    balance?: number;
    requesting_user?: { name: string; spent: number };
    providing_user?: { name: string; earned: number } | null;
    user_created?: boolean;
  };

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: data.error ?? `ledger ${res.status}`,
      balance: data.balance,
    };
  }
  if (!data.requesting_user) {
    return { ok: false, status: 502, error: "ledger_malformed_response" };
  }

  return {
    ok: true,
    spent: data.requesting_user.spent,
    user_created: !!data.user_created,
    provider: data.providing_user
      ? { name: data.providing_user.name, earned: data.providing_user.earned }
      : undefined,
  };
}
