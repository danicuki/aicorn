import { Hono } from "hono";
import type { Env } from "./env";
import { ledger } from "./routes/ledger";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("agentify ok"));
app.route("/", ledger);

export default app;
