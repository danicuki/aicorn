// Augments the ambient `Cloudflare.Env` interface used by `cloudflare:test`'s
// `env` export. Mirrors the bindings declared in vitest.config.mts's
// miniflare options. This file is a script (not a module) so the global
// `Cloudflare` namespace declaration merges with the workers-types ambient one.
declare namespace Cloudflare {
  interface Env {
    KV: KVNamespace;
  }
}
