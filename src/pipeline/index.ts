import { Hono } from "hono";
import type { Env } from "./env";
import { ledger } from "./routes/ledger";
import { buildFetchRoute } from "./routes/fetch";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("agentify ok"));
app.route("/", ledger);
app.route("/", buildFetchRoute(app));

export default app;
