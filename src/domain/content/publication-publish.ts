export type PublishPublicationInput = Readonly<{
  expectedVersion: number;
  confirmedRecipientCount: number;
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
 * Publication identity, lifecycle, publish time, and audience definition are
 * intentionally not caller-controlled.
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

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * A Publication must remain live for a non-zero interval when it is
 * published. The check belongs to the publish transition because the
 * authoritative publish time is chosen inside that transaction.
 */
export function isPublicationExpiryValidAtPublish(
  expiresAt: Date | null,
  publishAt: Date,
): boolean {
  return (
    isValidDate(publishAt) &&
    (expiresAt === null || (isValidDate(expiresAt) && expiresAt > publishAt))
  );
}
