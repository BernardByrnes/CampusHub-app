import { describe, expect, it } from "vitest";

import {
  assuranceAtLeast,
  assuranceLabel,
  assuranceLabelText,
  parseAssuranceLevel,
} from "./assurance-level";

describe("assuranceAtLeast", () => {
  it.each([
    ["L0", "L0", true],
    ["L0", "L1", false],
    ["L1", "L0", true],
    ["L1", "L1", true],
    ["L1", "L2", false],
    ["L2", "L0", true],
    ["L2", "L1", true],
    ["L2", "L2", true],
    ["L2", "L3", false],
    ["L3", "L0", true],
    ["L3", "L1", true],
    ["L3", "L2", true],
    ["L3", "L3", true],
  ] as const)("compares %s against %s", (actual, required, expected) => {
    expect(assuranceAtLeast(actual, required)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    "",
    "l2",
    "L4",
    "toString",
    "constructor",
    2,
    {},
    [],
  ])(
    "fails closed for malformed value %j",
    (value) => {
      expect(assuranceAtLeast(value, "L0")).toBe(false);
      expect(assuranceAtLeast("L3", value)).toBe(false);
      expect(parseAssuranceLevel(value)).toBeNull();
    },
  );
});

describe("assurance labels", () => {
  it("returns the exact display labels", () => {
    expect(assuranceLabel("L0")).toBe("L0 — Registered");
    expect(assuranceLabel("L1")).toBe("L1 — Weak Affiliation");
    expect(assuranceLabel("L2")).toBe("L2 — Roster Match");
    expect(assuranceLabel("L3")).toBe("L3 — Strong Institutional Proof");
  });

  it("also exposes the exact label text without the machine value", () => {
    expect(assuranceLabelText("L0")).toBe("Registered");
    expect(assuranceLabelText("L1")).toBe("Weak Affiliation");
    expect(assuranceLabelText("L2")).toBe("Roster Match");
    expect(assuranceLabelText("L3")).toBe("Strong Institutional Proof");
    expect(assuranceLabel("invalid")).toBeNull();
    expect(assuranceLabelText("invalid")).toBeNull();
  });
});
