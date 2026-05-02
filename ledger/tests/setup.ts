import { env } from "cloudflare:test";
import { beforeAll, beforeEach } from "vitest";

beforeAll(async () => {
  // Apply each migration file. D1 exec splits on ; and runs statements in
  // sequence; comments are stripped. Our migrations are simple CREATE TABLE +
  // INSERT, so no funky parsing edge cases.
  for (const sql of env.MIGRATION_SQL) {
    await env.DB.exec(sql.replace(/\n/g, " "));
  }
});

beforeEach(async () => {
  // Reset data between tests, keep the schema. Order matters: child tables
  // before parent (users) for foreign-key compliance.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM activity"),
    env.DB.prepare("DELETE FROM contributions"),
    env.DB.prepare("DELETE FROM users"),
    env.DB.prepare("UPDATE stats SET value = 0"),
  ]);
});
