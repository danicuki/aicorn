import { describe, it, expect } from "vitest";
import { estimateTokens } from "../../../src/pipeline/lib/tokens";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates ~1 token per 4 characters", () => {
    expect(estimateTokens("hello world!")).toBe(3);
  });

  it("rounds up partial tokens", () => {
    expect(estimateTokens("hello")).toBe(2);
  });

  it("handles unicode without crashing", () => {
    expect(estimateTokens("日本語")).toBeGreaterThan(0);
  });
});
