import {
  parseResourceVisibility,
  type ResourceVisibility,
} from "@/domain/authorization/resource-visibility";
import {
  parsePublicationAudienceMode,
  parsePublicationPriority,
  parsePublicationType,
  type PublicationAudienceMode,
  type PublicationPriority,
  type PublicationType,
} from "@/domain/content/publication";

const PUBLICATION_DRAFT_INPUT_KEYS = [
  "type",
  "title",
  "body",
  "priority",
  "visibility",
  "audienceMode",
  "authorOfficeLabel",
  "expiresAt",
] as const;

export type CreatePublicationDraftInput = Readonly<{
  type: PublicationType;
  title: string;
  body: string;
  priority?: PublicationPriority;
  visibility?: ResourceVisibility;
  audienceMode: PublicationAudienceMode;
  authorOfficeLabel: string;
  expiresAt?: Date | null;
}>;

export type CanonicalPublicationDraftInput = Readonly<{
  type: PublicationType;
  title: string;
  body: string;
  priority: PublicationPriority;
  visibility: ResourceVisibility;
  audienceMode: PublicationAudienceMode;
  authorOfficeLabel: string;
  expiresAt: Date | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableDate(value: unknown): value is Date | null {
  return (
    value === null ||
    (value instanceof Date && !Number.isNaN(value.getTime()))
  );
}

/**
 * Parses the caller-controlled authoring surface. Unknown properties are
 * rejected so lifecycle, ownership, actor, and unsupported media fields never
 * reach the Publication persistence boundary.
 */
export function parseCreatePublicationDraftInput(
  value: unknown,
): CanonicalPublicationDraftInput | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    Object.keys(value).some(
      (key) =>
        !(PUBLICATION_DRAFT_INPUT_KEYS as readonly string[]).includes(key),
    )
  ) {
    return null;
  }

  const type = parsePublicationType(value.type);
  const title = value.title;
  const body = value.body;
  const priority =
    value.priority === undefined
      ? "standard"
      : parsePublicationPriority(value.priority);
  const visibility =
    value.visibility === undefined
      ? "MEMBERS"
      : parseResourceVisibility(value.visibility);
  const audienceMode = parsePublicationAudienceMode(value.audienceMode);
  const authorOfficeLabel = value.authorOfficeLabel;
  const expiresAt = value.expiresAt === undefined ? null : value.expiresAt;

  if (
    type === null ||
    !isNonEmptyString(title) ||
    !isNonEmptyString(body) ||
    priority === null ||
    visibility === null ||
    audienceMode === null ||
    !isNonEmptyString(authorOfficeLabel) ||
    !isNullableDate(expiresAt)
  ) {
    return null;
  }

  return {
    type,
    title,
    body,
    priority,
    visibility,
    audienceMode,
    authorOfficeLabel,
    expiresAt,
  };
}
