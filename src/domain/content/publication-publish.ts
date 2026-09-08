import { isUuid } from "@/domain/identifiers/uuid";

export const PUBLICATION_AUDIT_EVENT_TYPES = ["published"] as const;

export type PublicationAuditEventType =
  (typeof PUBLICATION_AUDIT_EVENT_TYPES)[number];

export type PublishPublicationInput = Readonly<{
  expectedVersion: number;
  confirmedRecipientCount: number;
}>;

export type PublicationPublishAudienceSnapshot = Readonly<{
  mode: "entire_tenant" | "targeted";
  targets: readonly Readonly<{
    dimension:
      | "campus"
      | "academic_division"
      | "programme"
      | "academic_year"
      | "residence";
    targetId: string | null;
    targetValue: string | null;
    label: string;
  }>[];
}>;

export type PublicationPublishAuditEvent = Readonly<{
  tenantId: string;
  publicationId: string;
  eventType: PublicationAuditEventType;
  actorIdentitySubjectId: string;
  actorMembershipId: string;
  publicationVersion: number;
  confirmedRecipientCount: number;
  audienceSnapshot: PublicationPublishAudienceSnapshot;
  occurredAt: Date;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Parses the complete server-controlled confirmation for a manual publish.
 * Publication identity, actor identity, lifecycle, publish time, audience
 * definition, and target labels are intentionally not caller-controlled.
 */
export function parsePublishPublicationInput(
  value: unknown,
): PublishPublicationInput | null {
  if (!isRecord(value)) {
    return null;
  }

  const keys = Object.keys(value).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "confirmedRecipientCount" ||
    keys[1] !== "expectedVersion" ||
    !isPositiveInteger(value.expectedVersion) ||
    !isNonNegativeInteger(value.confirmedRecipientCount)
  ) {
    return null;
  }

  return {
    expectedVersion: value.expectedVersion,
    confirmedRecipientCount: value.confirmedRecipientCount,
  };
}

export const parsePublicationPublishInput = parsePublishPublicationInput;

export function isPublicationPublishAuditEvent(
  value: unknown,
): value is PublicationPublishAuditEvent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isUuid(value.tenantId) &&
    isUuid(value.publicationId) &&
    value.eventType === "published" &&
    typeof value.actorIdentitySubjectId === "string" &&
    value.actorIdentitySubjectId.trim().length > 0 &&
    isUuid(value.actorMembershipId) &&
    isPositiveInteger(value.publicationVersion) &&
    isNonNegativeInteger(value.confirmedRecipientCount) &&
    isRecord(value.audienceSnapshot) &&
    (value.audienceSnapshot.mode === "entire_tenant" ||
      value.audienceSnapshot.mode === "targeted") &&
    Array.isArray(value.audienceSnapshot.targets) &&
    value.audienceSnapshot.targets.every((target) => {
      if (!isRecord(target)) {
        return false;
      }

      return (
        typeof target.dimension === "string" &&
        [
          "campus",
          "academic_division",
          "programme",
          "academic_year",
          "residence",
        ].includes(target.dimension) &&
        (target.targetId === null || isUuid(target.targetId)) &&
        (target.targetValue === null || typeof target.targetValue === "string") &&
        typeof target.label === "string" &&
        target.label.trim().length > 0
      );
    }) &&
    value.occurredAt instanceof Date &&
    !Number.isNaN(value.occurredAt.getTime())
  );
}
