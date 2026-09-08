import { describe, expect, it } from "vitest";

import {
  isPublicationPublishAuditEvent,
  parsePublishPublicationInput,
} from "./publication-publish";

const tenantId = "00000000-0000-4000-8000-000000000001";
const publicationId = "00000000-0000-4000-8000-000000000002";
const membershipId = "00000000-0000-4000-8000-000000000003";
const occurredAt = new Date("2026-06-01T12:00:00.000Z");

describe("publication publish domain contracts", () => {
  it("accepts only the exact server-controlled confirmation shape", () => {
    expect(
      parsePublishPublicationInput({
        expectedVersion: 3,
        confirmedRecipientCount: 12,
      }),
    ).toEqual({ expectedVersion: 3, confirmedRecipientCount: 12 });

    for (const value of [
      { expectedVersion: 0, confirmedRecipientCount: 0 },
      { expectedVersion: 1.5, confirmedRecipientCount: 0 },
      { expectedVersion: 1, confirmedRecipientCount: -1 },
      { expectedVersion: 1, confirmedRecipientCount: 0, lifecycle: "published" },
      { expectedVersion: 1, confirmedRecipientCount: 0, tenantId },
    ]) {
      expect(parsePublishPublicationInput(value)).toBeNull();
    }
  });

  it("validates an immutable publish audit event and its audience snapshot", () => {
    expect(
      isPublicationPublishAuditEvent({
        tenantId,
        publicationId,
        eventType: "published",
        actorIdentitySubjectId: "identity-a",
        actorMembershipId: membershipId,
        publicationVersion: 4,
        confirmedRecipientCount: 12,
        audienceSnapshot: {
          mode: "targeted",
          targets: [
            {
              dimension: "campus",
              targetId: "00000000-0000-4000-8000-000000000004",
              targetValue: null,
              label: "Main campus",
            },
          ],
        },
        occurredAt,
      }),
    ).toBe(true);

    expect(
      isPublicationPublishAuditEvent({
        tenantId,
        publicationId,
        eventType: "published",
        actorIdentitySubjectId: "identity-a",
        actorMembershipId: membershipId,
        publicationVersion: 4,
        confirmedRecipientCount: 12,
        audienceSnapshot: { mode: "targeted", targets: [] },
        occurredAt,
      }),
    ).toBe(true);
  });
});
