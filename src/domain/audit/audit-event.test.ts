import { describe, expect, it } from "vitest";

import {
  AUDIT_EVENT_CONTRACT_VERSION,
  AUDIT_GENESIS_HASH,
  AUDIT_INTEGRITY_FORMAT_VERSION,
  canonicalizeAuditIntegrityEnvelope,
  isPublicationPublishedAuditEventFacts,
  normalizeAuditIntegrityEnvelope,
  normalizePublicationPublishedAuditEventFacts,
} from "./audit-event";

const tenantId = "00000000-0000-4000-8000-000000000001";
const eventId = "00000000-0000-4000-8000-000000000002";
const actorMembershipId = "00000000-0000-4000-8000-000000000003";
const publicationId = "00000000-0000-4000-8000-000000000004";
const campusId = "00000000-0000-4000-8000-000000000005";

const entireTenantFacts = {
  transition: { from: "draft" as const, to: "published" as const },
  audienceMode: "entire_tenant" as const,
  confirmedRecipientCount: 4,
  audienceSnapshot: {
    mode: "entire_tenant" as const,
    targets: [],
  },
};

const validEnvelope = {
  integrityFormatVersion: AUDIT_INTEGRITY_FORMAT_VERSION,
  eventContractVersion: AUDIT_EVENT_CONTRACT_VERSION,
  tenantId,
  sequence: 1,
  eventId,
  eventType: "publication.published" as const,
  actorMembershipId,
  resourceType: "publication" as const,
  resourceId: publicationId,
  resourceVersion: 2,
  occurredAt: "2026-09-09T10:00:00.000Z",
  eventFacts: entireTenantFacts,
  previousHash: AUDIT_GENESIS_HASH,
  keyVersion: 1,
};

describe("audit event contracts", () => {
  it("normalizes the closed publication.published facts shape", () => {
    const normalized = normalizePublicationPublishedAuditEventFacts({
      transition: { from: "draft", to: "published" },
      audienceMode: "targeted",
      confirmedRecipientCount: 7,
      audienceSnapshot: {
        mode: "targeted",
        targets: [
          {
            dimension: "campus",
            targetId: campusId.toUpperCase(),
            targetValue: null,
            targetLabel: "Main Campus",
          },
        ],
      },
    });

    expect(normalized).toEqual({
      transition: { from: "draft", to: "published" },
      audienceMode: "targeted",
      confirmedRecipientCount: 7,
      audienceSnapshot: {
        mode: "targeted",
        targets: [
          {
            dimension: "campus",
            targetId: campusId,
            targetValue: null,
            targetLabel: "Main Campus",
          },
        ],
      },
    });
    expect(isPublicationPublishedAuditEventFacts(normalized)).toBe(true);
  });

  it("orders targeted facts deterministically and preserves closed residence forms", () => {
    const first = normalizePublicationPublishedAuditEventFacts({
      ...entireTenantFacts,
      audienceMode: "targeted",
      audienceSnapshot: {
        mode: "targeted",
        targets: [
          {
            dimension: "residence",
            targetId: null,
            targetValue: "non_resident",
            targetLabel: null,
          },
          {
            dimension: "academic_year",
            targetId: null,
            targetValue: 2,
            targetLabel: null,
          },
          {
            dimension: "residence",
            targetId: null,
            targetValue: "any_resident",
            targetLabel: null,
          },
        ],
      },
    });
    const second = normalizePublicationPublishedAuditEventFacts({
      ...first,
      audienceSnapshot: {
        mode: "targeted",
        targets: [...(first?.audienceSnapshot.targets ?? [])].reverse(),
      },
    });

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
  });

  it("rejects extra, malformed, duplicated, and impossible audience facts", () => {
    expect(
      normalizePublicationPublishedAuditEventFacts({
        ...entireTenantFacts,
        extra: true,
      }),
    ).toBeNull();
    expect(
      normalizePublicationPublishedAuditEventFacts({
        ...entireTenantFacts,
        audienceMode: "targeted",
        audienceSnapshot: { mode: "targeted", targets: [] },
      }),
    ).toBeNull();
    expect(
      normalizePublicationPublishedAuditEventFacts({
        ...entireTenantFacts,
        audienceSnapshot: {
          mode: "entire_tenant",
          targets: [
            {
              dimension: "campus",
              targetId: campusId,
              targetValue: null,
              targetLabel: "Campus",
            },
          ],
        },
      }),
    ).toBeNull();
    expect(
      normalizePublicationPublishedAuditEventFacts({
        transition: { from: "published", to: "draft" },
        audienceMode: "entire_tenant",
        confirmedRecipientCount: 0,
        audienceSnapshot: { mode: "entire_tenant", targets: [] },
      }),
    ).toBeNull();
  });

  it("normalizes and canonicalizes the integrity envelope", () => {
    const normalized = normalizeAuditIntegrityEnvelope({
      ...validEnvelope,
      tenantId: tenantId.toUpperCase(),
      eventId: eventId.toUpperCase(),
      actorMembershipId: actorMembershipId.toUpperCase(),
      resourceId: publicationId.toUpperCase(),
    });

    expect(normalized).toMatchObject({
      tenantId,
      eventId,
      actorMembershipId,
      resourceId: publicationId,
    });
    expect(canonicalizeAuditIntegrityEnvelope(validEnvelope)).toBe(
      canonicalizeAuditIntegrityEnvelope({
        ...validEnvelope,
        tenantId: tenantId.toUpperCase(),
        eventId: eventId.toUpperCase(),
        actorMembershipId: actorMembershipId.toUpperCase(),
        resourceId: publicationId.toUpperCase(),
      }),
    );
  });

  it("rejects envelope drift and non-canonical values", () => {
    expect(
      normalizeAuditIntegrityEnvelope({
        ...validEnvelope,
        integrityFormatVersion: 2,
      }),
    ).toBeNull();
    expect(
      normalizeAuditIntegrityEnvelope({
        ...validEnvelope,
        unknown: true,
      }),
    ).toBeNull();
    expect(
      normalizeAuditIntegrityEnvelope({
        ...validEnvelope,
        occurredAt: "2026-09-09T10:00:00Z",
      }),
    ).toBeNull();
    expect(() =>
      canonicalizeAuditIntegrityEnvelope({
        ...validEnvelope,
        eventFacts: {
          ...entireTenantFacts,
          confirmedRecipientCount: Number.NaN,
        },
      }),
    ).toThrow();
  });
});
