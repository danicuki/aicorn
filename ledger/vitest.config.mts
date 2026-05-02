import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// vitest config runs in Node, so we can read migrations from disk here and
// hand them to the test environment as a binding. The setup file then
// applies them with env.DB.exec on a fresh in-memory D1.
const migrationsDir = resolve(import.meta.dirname, "./migrations");
const migrationSql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(resolve(migrationsDir, f), "utf8"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2025-05-01",
        d1Databases: ["DB"],
        bindings: {
          MIGRATION_SQL: migrationSql,
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./tests/setup.ts"],
  },
});
