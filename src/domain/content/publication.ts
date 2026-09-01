import {
  parseResourceVisibility,
  type ResourceVisibility,
} from "@/domain/authorization/resource-visibility";

export const PUBLICATION_TYPES = ["notice", "news"] as const;

export type PublicationType = (typeof PUBLICATION_TYPES)[number];

export const PUBLICATION_PRIORITIES = ["standard", "priority"] as const;

export type PublicationPriority = (typeof PUBLICATION_PRIORITIES)[number];

export const PUBLICATION_LIFECYCLES = [
  "draft",
  "scheduled",
  "published",
  "expired",
  "archived",
] as const;

export type PublicationLifecycle = (typeof PUBLICATION_LIFECYCLES)[number];

export const PUBLICATION_AUDIENCE_MODES = [
  "entire_tenant",
  "targeted",
] as const;

export type PublicationAudienceMode =
  (typeof PUBLICATION_AUDIENCE_MODES)[number];

export type Publication = Readonly<{
  id: string;
  tenantId: string;
  type: PublicationType;
  title: string;
  body: string;
  priority: PublicationPriority;
  visibility: ResourceVisibility;
  lifecycle: PublicationLifecycle;
  audienceMode: PublicationAudienceMode;
  authorOfficeLabel: string;
  publishAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parsePublicationType(value: unknown): PublicationType | null {
  return typeof value === "string" &&
    (PUBLICATION_TYPES as readonly string[]).includes(value)
    ? (value as PublicationType)
    : null;
}

export function parsePublicationPriority(
  value: unknown,
): PublicationPriority | null {
  return typeof value === "string" &&
    (PUBLICATION_PRIORITIES as readonly string[]).includes(value)
    ? (value as PublicationPriority)
    : null;
}

export function parsePublicationLifecycle(
  value: unknown,
): PublicationLifecycle | null {
  return typeof value === "string" &&
    (PUBLICATION_LIFECYCLES as readonly string[]).includes(value)
    ? (value as PublicationLifecycle)
    : null;
}

export function parsePublicationAudienceMode(
  value: unknown,
): PublicationAudienceMode | null {
  return typeof value === "string" &&
    (PUBLICATION_AUDIENCE_MODES as readonly string[]).includes(value)
    ? (value as PublicationAudienceMode)
    : null;
}

function isNullableDate(value: unknown): value is Date | null {
  return (
    value === null ||
    (value instanceof Date && !Number.isNaN(value.getTime()))
  );
}

export function isPublication(value: unknown): value is Publication {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.tenantId) &&
    parsePublicationType(candidate.type) !== null &&
    isNonEmptyString(candidate.title) &&
    isNonEmptyString(candidate.body) &&
    parsePublicationPriority(candidate.priority) !== null &&
    parseResourceVisibility(candidate.visibility) !== null &&
    parsePublicationLifecycle(candidate.lifecycle) !== null &&
    parsePublicationAudienceMode(candidate.audienceMode) !== null &&
    isNonEmptyString(candidate.authorOfficeLabel) &&
    isNullableDate(candidate.publishAt) &&
    isNullableDate(candidate.expiresAt) &&
    candidate.createdAt instanceof Date &&
    !Number.isNaN(candidate.createdAt.getTime()) &&
    candidate.updatedAt instanceof Date &&
    !Number.isNaN(candidate.updatedAt.getTime())
  );
}
