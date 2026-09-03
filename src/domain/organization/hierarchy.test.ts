import { describe, expect, it } from "vitest";

import {
  isAcademicDivisionLevel,
  parseAcademicDivisionLifecycle,
  parseCampusLifecycle,
  parseProgrammeLifecycle,
  parseResidenceLifecycle,
} from "./hierarchy";

describe("Tenant hierarchy domain vocabulary", () => {
  it("accepts only the closed lifecycle sets", () => {
    expect(parseCampusLifecycle("active")).toBe("active");
    expect(parseCampusLifecycle("merged")).toBeNull();
    expect(parseAcademicDivisionLifecycle("merged")).toBe("merged");
    expect(parseProgrammeLifecycle("inactive")).toBe("inactive");
    expect(parseResidenceLifecycle("merged")).toBeNull();
    expect(parseProgrammeLifecycle("unknown")).toBeNull();
  });

  it("limits academic divisions to the approved one- or two-level depth", () => {
    expect(isAcademicDivisionLevel(1)).toBe(true);
    expect(isAcademicDivisionLevel(2)).toBe(true);
    expect(isAcademicDivisionLevel(0)).toBe(false);
    expect(isAcademicDivisionLevel(3)).toBe(false);
  });
});
