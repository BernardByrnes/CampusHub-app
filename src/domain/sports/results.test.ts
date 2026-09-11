import { describe, expect, it } from "vitest";

import {
  parseResultExpectedVersion,
  parseResultHistoryLimit,
  parseResultReason,
  parseResultScore,
} from "./results";

describe("Result domain contract", () => {
  it("accepts only bounded nonnegative integer scores", () => {
    expect(parseResultScore(0)).toBe(0);
    expect(parseResultScore(1000)).toBe(1000);
    expect(parseResultScore(-1)).toBeNull();
    expect(parseResultScore(1001)).toBeNull();
    expect(parseResultScore(1.5)).toBeNull();
    expect(parseResultScore("1")).toBeNull();
  });

  it("requires positive expected versions and bounded history limits", () => {
    expect(parseResultExpectedVersion(1)).toBe(1);
    expect(parseResultExpectedVersion(0)).toBeNull();
    expect(parseResultExpectedVersion(1.2)).toBeNull();
    expect(parseResultHistoryLimit(undefined)).toBe(50);
    expect(parseResultHistoryLimit(100)).toBe(100);
    expect(parseResultHistoryLimit(101)).toBeNull();
  });

  it("normalizes nonempty correction reasons without accepting oversized input", () => {
    expect(parseResultReason("  Official correction  ")).toBe("Official correction");
    expect(parseResultReason("   ")).toBeNull();
    expect(parseResultReason("x".repeat(501))).toBeNull();
  });
});
