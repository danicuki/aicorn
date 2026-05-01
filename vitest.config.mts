import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// Inline miniflare config for tests. We intentionally do NOT reference
// wrangler.toml: the production [ai] binding triggers a remote-proxy session
// that requires CLOUDFLARE_ACCOUNT_ID and fails in non-interactive runs.
// Task 5's KV-store tests only need a KV binding, so we declare it here.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2025-04-01",
        kvNamespaces: ["KV"],
      },
    }),
  ],
});
