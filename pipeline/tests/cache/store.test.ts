import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { readCache, writeCache, bumpHitCount } from "../../src/cache/store";
import type { CacheEntry } from "../../src/cache/types";

const sampleKey = "cache:abc";
const sample: CacheEntry = {
  markdown: "# hi",
  contributor_user_id: "user-A",
  extracted_at: 1714560000000,
  source_etag: null,
  hit_count: 0,
  original_html_tokens: 8000,
  extracted_tokens: 400,
};

describe("cache store", () => {
  it("returns null for missing key", async () => {
    expect(await readCache(env.KV, "cache:does-not-exist")).toBeNull();
  });

  it("round-trips a CacheEntry", async () => {
    await writeCache(env.KV, sampleKey, sample);
    const read = await readCache(env.KV, sampleKey);
    expect(read).toEqual(sample);
  });

  it("bumpHitCount increments and persists", async () => {
    await writeCache(env.KV, sampleKey, sample);
    const after = await bumpHitCount(env.KV, sampleKey);
    expect(after?.hit_count).toBe(1);
    const reread = await readCache(env.KV, sampleKey);
    expect(reread?.hit_count).toBe(1);
  });

  it("bumpHitCount is a no-op when key missing", async () => {
    expect(await bumpHitCount(env.KV, "cache:nope")).toBeNull();
  });
});
