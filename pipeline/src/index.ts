import { Hono } from "hono";
import type { Env } from "./env";
import { buildFetchRoute } from "./routes/fetch";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("aicorn ok"));
app.route("/", buildFetchRoute());

export default app;
