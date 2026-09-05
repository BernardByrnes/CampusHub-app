import {
  parseResourceVisibility,
  type ResourceVisibility,
} from "@/domain/authorization/resource-visibility";
import {
  parsePublicationPriority,
  parsePublicationType,
  type PublicationPriority,
  type PublicationType,
} from "@/domain/content/publication";

const UPDATE_PUBLICATION_DRAFT_INPUT_KEYS = [
  "expectedVersion",
  "type",
  "title",
  "body",
  "priority",
  "visibility",
  "authorOfficeLabel",
  "expiresAt",
] as const;

export type UpdatePublicationDraftInput = Readonly<{
  expectedVersion: number;
  type: PublicationType;
  title: string;
  body: string;
  priority: PublicationPriority;
  visibility: ResourceVisibility;
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

function hasExactInputKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === UPDATE_PUBLICATION_DRAFT_INPUT_KEYS.length &&
    keys.every((key) =>
      (UPDATE_PUBLICATION_DRAFT_INPUT_KEYS as readonly string[]).includes(key),
    )
  );
}

/**
 * Parses the complete caller-controlled replacement for editable draft
 * metadata. Exact keys make lifecycle, audience, ownership, actor, and
 * server-managed fields impossible to smuggle through this boundary.
 */
export function parseUpdatePublicationDraftInput(
  value: unknown,
): UpdatePublicationDraftInput | null {
  if (!isRecord(value) || !hasExactInputKeys(value)) {
    return null;
  }

  const expectedVersion = value.expectedVersion;
  const type = parsePublicationType(value.type);
  const title = value.title;
  const body = value.body;
  const priority = parsePublicationPriority(value.priority);
  const visibility = parseResourceVisibility(value.visibility);
  const authorOfficeLabel = value.authorOfficeLabel;
  const expiresAt = value.expiresAt;

  if (
    typeof expectedVersion !== "number" ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 1 ||
    type === null ||
    !isNonEmptyString(title) ||
    !isNonEmptyString(body) ||
    priority === null ||
    visibility === null ||
    !isNonEmptyString(authorOfficeLabel) ||
    !isNullableDate(expiresAt)
  ) {
    return null;
  }

  return {
    expectedVersion,
    type,
    title,
    body,
    priority,
    visibility,
    authorOfficeLabel,
    expiresAt,
  };
}
