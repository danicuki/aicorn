// Augments the ambient `Cloudflare.Env` interface used by `cloudflare:test`'s
// `env` export. Mirrors the bindings declared in vitest.config.mts's
// miniflare options. Script file (not a module) so the namespace merges with
// the workers-types ambient declaration.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    MIGRATION_SQL: string[];
  }
}
