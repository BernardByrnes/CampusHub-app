import { Buffer } from "node:buffer";

import { isUuid } from "@/domain/identifiers/uuid";

import type { Publication } from "./publication";

export const PUBLICATION_COLLECTION_SURFACES = ["ACTIVE", "ARCHIVE"] as const;

export type PublicationCollectionSurface =
  (typeof PUBLICATION_COLLECTION_SURFACES)[number];

export function parsePublicationCollectionSurface(
  value: unknown,
): PublicationCollectionSurface | null {
  return typeof value === "string" &&
    (PUBLICATION_COLLECTION_SURFACES as readonly string[]).includes(value)
    ? (value as PublicationCollectionSurface)
    : null;
}

export const PUBLICATION_COLLECTION_CURSOR_VERSION = 1 as const;

export type PublicationCollectionCursor = Readonly<{
  publishAt: Date;
  id: string;
}>;

export type PublicationCollectionQuery = Readonly<{
  tenantId: string;
  surface: PublicationCollectionSurface;
  now: Date;
  cursor: PublicationCollectionCursor | null;
  limit: number;
}>;

export type PublicationCollectionCandidatePage = Readonly<{
  items: Publication[];
  hasMoreCandidateRows: boolean;
}>;

export const DEFAULT_PUBLICATION_PAGE_SIZE = 20;
export const MIN_PUBLICATION_PAGE_SIZE = 1;
export const MAX_PUBLICATION_PAGE_SIZE = 50;
export const PUBLICATION_COLLECTION_OVERFETCH_FACTOR = 3;
export const MAX_PUBLICATION_CANDIDATES_SCANNED = 150;
export const MIN_PUBLICATION_CANDIDATE_BATCH_SIZE = 25;
export const MAX_PUBLICATION_COLLECTION_QUERY_ROUNDS = 6;

export function normalizePublicationPageSize(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_PUBLICATION_PAGE_SIZE;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PUBLICATION_PAGE_SIZE;
  }

  if (!Number.isInteger(value)) {
    return DEFAULT_PUBLICATION_PAGE_SIZE;
  }

  return Math.min(
    MAX_PUBLICATION_PAGE_SIZE,
    Math.max(MIN_PUBLICATION_PAGE_SIZE, value),
  );
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function parseCanonicalIsoTimestamp(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
    ? parsed
    : null;
}

export function isPublicationCollectionCursor(
  value: unknown,
): value is PublicationCollectionCursor {
  return (
    typeof value === "object" &&
    value !== null &&
    isValidDate((value as Record<string, unknown>).publishAt) &&
    isUuid((value as Record<string, unknown>).id)
  );
}

/**
 * Encodes only the keyset position. The payload deliberately has no Tenant,
 * viewer, policy, or Publication-content fields; Tenant scope always comes
 * from the trusted collection-service input.
 */
export function encodePublicationCursor(
  cursor: PublicationCollectionCursor,
): string | null {
  if (!isPublicationCollectionCursor(cursor)) {
    return null;
  }

  const payload = JSON.stringify({
    v: PUBLICATION_COLLECTION_CURSOR_VERSION,
    publishAt: cursor.publishAt.toISOString(),
    id: cursor.id,
  });

  return Buffer.from(payload, "utf8").toString("base64url");
}

/**
 * Decodes a strict, versioned cursor and rejects unknown fields. This keeps
 * malformed or future cursors deterministic and prevents payload fields from
 * becoming an accidental authorization or query input.
 */
export function decodePublicationCursor(
  value: unknown,
): PublicationCollectionCursor | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length % 4 === 1
  ) {
    return null;
  }

  let decoded: string;
  try {
    const bytes = Buffer.from(value, "base64url");
    decoded = bytes.toString("utf8");

    if (Buffer.from(decoded, "utf8").toString("base64url") !== value) {
      return null;
    }
  } catch {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decoded);
  } catch {
    return null;
  }

  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 3 || keys.join("\u0000") !== "id\u0000publishAt\u0000v") {
    return null;
  }

  const publishAt = parseCanonicalIsoTimestamp(record.publishAt);
  if (
    record.v !== PUBLICATION_COLLECTION_CURSOR_VERSION ||
    publishAt === null ||
    !isUuid(record.id)
  ) {
    return null;
  }

  return { publishAt, id: record.id };
}
