import { describe, it, expect } from "vitest";
import { cacheKey } from "../../src/cache/key";

describe("cacheKey", () => {
  it("produces a stable sha256-prefixed key for a URL", async () => {
    const k1 = await cacheKey("https://example.com/foo");
    const k2 = await cacheKey("https://example.com/foo");
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^cache:[0-9a-f]{64}$/);
  });

  it("produces different keys for different URLs", async () => {
    const a = await cacheKey("https://example.com/a");
    const b = await cacheKey("https://example.com/b");
    expect(a).not.toBe(b);
  });
});
