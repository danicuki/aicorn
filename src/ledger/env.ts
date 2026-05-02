export interface Env {
  DB: D1Database;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function html(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function readJson<T = unknown>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
