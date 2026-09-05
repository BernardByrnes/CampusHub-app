import { describe, expect, it } from "vitest";

import {
  parseUpdatePublicationDraftInput,
  type UpdatePublicationDraftInput,
} from "./publication-draft-edit";

const validInput: UpdatePublicationDraftInput = {
  expectedVersion: 3,
  type: "notice",
  title: "Updated title",
  body: "Updated body",
  priority: "priority",
  visibility: "PUBLIC",
  authorOfficeLabel: "Communications",
  expiresAt: new Date("2026-12-01T00:00:00.000Z"),
};

describe("parseUpdatePublicationDraftInput", () => {
  it("accepts the complete editable draft replacement", () => {
    expect(parseUpdatePublicationDraftInput(validInput)).toEqual(validInput);
  });

  it.each([
    "id",
    "tenantId",
    "version",
    "lifecycle",
    "publishAt",
    "audienceMode",
    "audience",
    "criteria",
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
    "unknown",
  ])("rejects forbidden or unknown field %s", (field) => {
    expect(
      parseUpdatePublicationDraftInput({
        ...validInput,
        [field]: "forged",
      }),
    ).toBeNull();
  });

  it.each([
    { expectedVersion: 0 },
    { expectedVersion: -1 },
    { expectedVersion: 1.5 },
    { expectedVersion: "3" },
    { expectedVersion: null },
    { type: "unknown" },
    { title: "   " },
    { body: "" },
    { priority: "urgent" },
    { visibility: "PRIVATE" },
    { authorOfficeLabel: "" },
    { expiresAt: "2026-12-01T00:00:00.000Z" },
  ])("fails closed for malformed editable value: %o", (override) => {
    expect(
      parseUpdatePublicationDraftInput({ ...validInput, ...override }),
    ).toBeNull();
  });

  it("requires every editable field and does not apply create defaults", () => {
    const withoutPriority = {
      expectedVersion: validInput.expectedVersion,
      type: validInput.type,
      title: validInput.title,
      body: validInput.body,
      visibility: validInput.visibility,
      authorOfficeLabel: validInput.authorOfficeLabel,
      expiresAt: validInput.expiresAt,
    };
    expect(parseUpdatePublicationDraftInput(withoutPriority)).toBeNull();
  });
});
