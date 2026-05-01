import { describe, it, expect } from "vitest";
import { detectAgent } from "../../../src/pipeline/lib/agent";

describe("detectAgent", () => {
  it("detects ClaudeBot via User-Agent", () => {
    const h = new Headers({ "User-Agent": "Mozilla/5.0 (compatible; ClaudeBot/1.0)" });
    expect(detectAgent(h)).toBe(true);
  });

  it("detects GPTBot via User-Agent", () => {
    const h = new Headers({ "User-Agent": "GPTBot/1.0" });
    expect(detectAgent(h)).toBe(true);
  });

  it("detects PerplexityBot", () => {
    const h = new Headers({ "User-Agent": "PerplexityBot/1.0" });
    expect(detectAgent(h)).toBe(true);
  });

  it("respects X-Agent: true override", () => {
    const h = new Headers({ "User-Agent": "curl/8.0", "X-Agent": "true" });
    expect(detectAgent(h)).toBe(true);
  });

  it("returns false for plain browser UA without override", () => {
    const h = new Headers({ "User-Agent": "Mozilla/5.0 (Macintosh)" });
    expect(detectAgent(h)).toBe(false);
  });

  it("returns false when no headers", () => {
    expect(detectAgent(new Headers())).toBe(false);
  });
});
