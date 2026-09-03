import { describe, expect, it } from "vitest";

import {
  validatePublicationAudienceConfirmation,
} from "./publication-audience-confirmation";

const current = {
  publicationVersion: 3,
  estimatedRecipientCount: 12,
  audienceDefinitionValid: true,
  targetsCurrentlyValid: true,
};

describe("publication audience confirmation", () => {
  it("accepts the exact current version and scalar count", () => {
    expect(
      validatePublicationAudienceConfirmation(
        { expectedPublicationVersion: 3, confirmedRecipientCount: 12 },
        current,
      ),
    ).toEqual({ ok: true });
  });

  it("rejects stale versions as a version conflict", () => {
    expect(
      validatePublicationAudienceConfirmation(
        { expectedPublicationVersion: 2, confirmedRecipientCount: 12 },
        current,
      ),
    ).toEqual({ ok: false, error: "VERSION_CONFLICT" });
  });

  it("requires reconfirmation when the estimate changes", () => {
    expect(
      validatePublicationAudienceConfirmation(
        { expectedPublicationVersion: 3, confirmedRecipientCount: 11 },
        current,
      ),
    ).toEqual({ ok: false, error: "RECONFIRM_REQUIRED" });
  });

  it("rejects confirmations for invalid targets", () => {
    expect(
      validatePublicationAudienceConfirmation(
        { expectedPublicationVersion: 3, confirmedRecipientCount: 12 },
        { ...current, targetsCurrentlyValid: false },
      ),
    ).toEqual({ ok: false, error: "NOT_READY" });
  });

  it("does not accept caller-provided identities", () => {
    expect(
      validatePublicationAudienceConfirmation(
        {
          expectedPublicationVersion: 3,
          confirmedRecipientCount: 12,
          identitySubjectIds: ["identity-a"],
        },
        current,
      ),
    ).toEqual({ ok: false, error: "RECONFIRM_REQUIRED" });
  });
});
