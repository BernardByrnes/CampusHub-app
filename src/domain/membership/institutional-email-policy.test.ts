import { describe, expect, it } from "vitest";

import {
  assuranceRemainsWithinInstitutionalEmailCap,
  institutionalEmailEvidenceMaximum,
  institutionalEmailSupportsL3,
} from "./institutional-email-policy";

describe("institutional email assurance invariant", () => {
  it("does not treat email evidence alone as L3 proof", () => {
    const incomplete = {
      identityBinding: true,
      currentEnrollment: true,
      reliableRevocation: false,
    };

    expect(institutionalEmailSupportsL3(incomplete)).toBe(false);
    expect(institutionalEmailEvidenceMaximum(incomplete)).toBe("L2");
    expect(assuranceRemainsWithinInstitutionalEmailCap("L2", incomplete)).toBe(
      true,
    );
    expect(assuranceRemainsWithinInstitutionalEmailCap("L3", incomplete)).toBe(
      false,
    );
  });

  it("requires all tenant-attested conditions before L3 can be supported", () => {
    const complete = {
      identityBinding: true,
      currentEnrollment: true,
      reliableRevocation: true,
    };

    expect(institutionalEmailSupportsL3(complete)).toBe(true);
    expect(institutionalEmailEvidenceMaximum(complete)).toBe("L3");
    expect(assuranceRemainsWithinInstitutionalEmailCap("L3", complete)).toBe(
      true,
    );
  });

  it("fails closed for malformed attestation", () => {
    expect(institutionalEmailSupportsL3(null)).toBe(false);
    expect(institutionalEmailSupportsL3({ identityBinding: true })).toBe(false);
    expect(institutionalEmailEvidenceMaximum(null)).toBe("L2");
    expect(assuranceRemainsWithinInstitutionalEmailCap("not-a-level", null)).toBe(
      false,
    );
  });
});
