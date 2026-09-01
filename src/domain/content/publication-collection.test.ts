import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  decodePublicationCursor,
  DEFAULT_PUBLICATION_PAGE_SIZE,
  encodePublicationCursor,
  MAX_PUBLICATION_CANDIDATES_SCANNED,
  MAX_PUBLICATION_PAGE_SIZE,
  MIN_PUBLICATION_PAGE_SIZE,
  normalizePublicationPageSize,
  parsePublicationCollectionSurface,
} from "./publication-collection";

const cursor = {
  publishAt: new Date("2026-01-15T12:00:00.000Z"),
  id: "00000000-0000-4000-8000-000000000001",
};

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

describe("Publication collection contract", () => {
  it("accepts exactly ACTIVE and ARCHIVE collection surfaces", () => {
    expect(parsePublicationCollectionSurface("ACTIVE")).toBe("ACTIVE");
    expect(parsePublicationCollectionSurface("ARCHIVE")).toBe("ARCHIVE");
    expect(parsePublicationCollectionSurface("HOME")).toBeNull();
    expect(parsePublicationCollectionSurface("active")).toBeNull();
  });

  it("round-trips an opaque versioned keyset cursor", () => {
    const encoded = encodePublicationCursor(cursor);

    expect(encoded).toEqual(expect.any(String));
    expect(encoded).not.toContain(cursor.id);
    expect(decodePublicationCursor(encoded)).toEqual(cursor);
  });

  it("rejects malformed, future, unsafe, and non-canonical cursors", () => {
    const malformed = [
      "",
      "garbage",
      "!!!!",
      encodePayload({ v: 2, publishAt: cursor.publishAt.toISOString(), id: cursor.id }),
      encodePayload({ v: 1, publishAt: cursor.publishAt.toISOString(), id: "banana" }),
      encodePayload({ v: 1, publishAt: "2026-01-15", id: cursor.id }),
      encodePayload({ v: 1, publishAt: cursor.publishAt.toISOString(), id: cursor.id, dangerous: "x" }),
      encodePayload({ v: 1, publishAt: cursor.publishAt.toISOString(), id: cursor.id }).slice(0, -1),
      "a",
    ];

    for (const value of malformed) {
      expect(decodePublicationCursor(value)).toBeNull();
    }
  });

  it("normalizes page sizes to the documented bounds", () => {
    expect(normalizePublicationPageSize(undefined)).toBe(
      DEFAULT_PUBLICATION_PAGE_SIZE,
    );
    expect(normalizePublicationPageSize("50")).toBe(
      DEFAULT_PUBLICATION_PAGE_SIZE,
    );
    expect(normalizePublicationPageSize(0)).toBe(MIN_PUBLICATION_PAGE_SIZE);
    expect(normalizePublicationPageSize(-20)).toBe(MIN_PUBLICATION_PAGE_SIZE);
    expect(normalizePublicationPageSize(7.5)).toBe(
      DEFAULT_PUBLICATION_PAGE_SIZE,
    );
    expect(normalizePublicationPageSize(500)).toBe(MAX_PUBLICATION_PAGE_SIZE);
    expect(normalizePublicationPageSize(7)).toBe(7);
    expect(MAX_PUBLICATION_CANDIDATES_SCANNED).toBe(150);
  });
});
