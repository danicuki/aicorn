import { Env, json } from "./env";
import { ledgerCharge, ledgerCredit, getLedger } from "./ledger";
import { getStats, incrStat } from "./stats";
import { adminHandler } from "./admin";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (pathname === "/" && method === "GET") {
      return Response.redirect(new URL("/admin", request.url).toString(), 302);
    }

    if (pathname === "/ledger/charge" && method === "POST") return ledgerCharge(request, env);
    if (pathname === "/ledger/credit" && method === "POST") return ledgerCredit(request, env);
    const ledgerMatch = pathname.match(/^\/ledger\/([^/]+)$/);
    if (ledgerMatch && method === "GET") {
      return getLedger(decodeURIComponent(ledgerMatch[1]), env);
    }

    if (pathname === "/stats" && method === "GET") return getStats(env);
    if (pathname === "/stats/incr" && method === "POST") return incrStat(request, env);

    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      return adminHandler(request, env);
    }

    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
