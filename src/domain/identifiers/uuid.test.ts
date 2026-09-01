import { describe, expect, it } from "vitest";

import { isUuid, parseUuid } from "./uuid";

const validUuid = "00000000-0000-4000-8000-000000000001";

describe("UUID identifier guard", () => {
  it("accepts canonical UUID strings and preserves the parsed value", () => {
    expect(isUuid(validUuid)).toBe(true);
    expect(isUuid(validUuid.toUpperCase())).toBe(true);
    expect(parseUuid(validUuid)).toBe(validUuid);
  });

  it("rejects malformed, non-string, and non-UUID variant values", () => {
    expect(parseUuid("banana")).toBeNull();
    expect(parseUuid("123")).toBeNull();
    expect(parseUuid("not-a-uuid")).toBeNull();
    expect(parseUuid("00000000-0000-4000-7000-000000000001")).toBeNull();
    expect(isUuid(null)).toBe(false);
    expect(isUuid({})).toBe(false);
  });
});
