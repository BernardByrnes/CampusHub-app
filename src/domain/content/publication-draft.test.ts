import { describe, expect, it } from "vitest";

import {
  parseCreatePublicationDraftInput,
  type CreatePublicationDraftInput,
} from "./publication-draft";

const validInput: CreatePublicationDraftInput = {
  type: "notice",
  title: "Draft title",
  body: "Draft body",
  audienceMode: "entire_tenant",
  authorOfficeLabel: "Communications",
};

describe("parseCreatePublicationDraftInput", () => {
  it("DRAFT-01 through DRAFT-03 normalize a valid payload to a draft-safe shape", () => {
    expect(parseCreatePublicationDraftInput(validInput)).toEqual({
      type: "notice",
      title: "Draft title",
      body: "Draft body",
      priority: "standard",
      visibility: "MEMBERS",
      audienceMode: "entire_tenant",
      authorOfficeLabel: "Communications",
      expiresAt: null,
    });
  });

  it("DRAFT-04 through DRAFT-06 preserve explicit supported metadata", () => {
    const expiresAt = new Date("2026-12-01T00:00:00.000Z");
    expect(
      parseCreatePublicationDraftInput({
        ...validInput,
        priority: "priority",
        visibility: "PUBLIC",
        expiresAt,
      }),
    ).toEqual({
      ...validInput,
      priority: "priority",
      visibility: "PUBLIC",
      expiresAt,
    });
  });

  it.each([
    "id",
    "tenantId",
    "version",
    "lifecycle",
    "publishAt",
    "createdAt",
    "updatedAt",
    "actorId",
    "membershipId",
    "identitySubjectId",
    "role",
    "capability",
    "isPublisher",
    "isAdmin",
    "image",
    "attachment",
    "file",
    "mediaUrl",
  ])("DRAFT-SEC rejects forbidden field %s", (field) => {
    expect(
      parseCreatePublicationDraftInput({
        ...validInput,
        [field]: field === "lifecycle" ? "published" : "forged",
      }),
    ).toBeNull();
  });

  it.each([
    { type: "unknown" },
    { title: "   " },
    { body: "" },
    { priority: "urgent" },
    { visibility: "PRIVATE" },
    { audienceMode: "everyone" },
    { authorOfficeLabel: "" },
    { expiresAt: "2026-12-01T00:00:00.000Z" },
  ])("fails closed for malformed supported field values: %o", (override) => {
    expect(
      parseCreatePublicationDraftInput({ ...validInput, ...override }),
    ).toBeNull();
  });
});
