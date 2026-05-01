import { Hono } from "hono";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("agentify ok"));

export default app;
