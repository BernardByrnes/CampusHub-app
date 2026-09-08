import { describe, expect, it } from "vitest";

import {
  isPublicationExpiryValidAtPublish,
  parsePublishPublicationInput,
} from "./publication-publish";

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
    ]) {
      expect(parsePublishPublicationInput(value)).toBeNull();
    }
  });

  it("requires an absent or strictly later expiry at the authoritative publish time", () => {
    const publishAt = new Date("2026-06-01T12:00:00.000Z");

    expect(isPublicationExpiryValidAtPublish(null, publishAt)).toBe(true);
    expect(
      isPublicationExpiryValidAtPublish(
        new Date("2026-06-01T12:00:01.000Z"),
        publishAt,
      ),
    ).toBe(true);
    expect(
      isPublicationExpiryValidAtPublish(
        new Date("2026-06-01T12:00:00.000Z"),
        publishAt,
      ),
    ).toBe(false);
    expect(
      isPublicationExpiryValidAtPublish(
        new Date("2026-06-01T11:59:59.000Z"),
        publishAt,
      ),
    ).toBe(false);
  });
});
