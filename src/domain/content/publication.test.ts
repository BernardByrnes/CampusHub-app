import { describe, expect, it } from "vitest";

import { RESOURCE_VISIBILITIES } from "@/domain/authorization/resource-visibility";

import {
  isPublication,
  parsePublicationAudienceMode,
  parsePublicationLifecycle,
  parsePublicationPriority,
  parsePublicationType,
  PUBLICATION_LIFECYCLES,
  PUBLICATION_AUDIENCE_MODES,
  PUBLICATION_PRIORITIES,
  PUBLICATION_TYPES,
  type Publication,
} from "./publication";

const basePublication: Publication = {
  id: "publication-alpha-a",
  tenantId: "tenant-alpha",
  type: "news",
  title: "Campus update",
  body: "The campus update body.",
  priority: "standard",
  visibility: "MEMBERS",
  lifecycle: "draft",
  audienceMode: "entire_tenant",
  authorOfficeLabel: "Guild Communications Office",
  publishAt: null,
  expiresAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("Publication domain", () => {
  it("uses the frozen Publication type, lifecycle, and shared visibility values", () => {
    expect(PUBLICATION_TYPES).toEqual(["notice", "news"]);
    expect(PUBLICATION_PRIORITIES).toEqual(["standard", "priority"]);
    expect(PUBLICATION_AUDIENCE_MODES).toEqual([
      "entire_tenant",
      "targeted",
    ]);
    expect(PUBLICATION_LIFECYCLES).toEqual([
      "draft",
      "scheduled",
      "published",
      "expired",
      "archived",
    ]);
    expect(RESOURCE_VISIBILITIES).toEqual([
      "PUBLIC",
      "MEMBERS",
      "VERIFIED_MEMBERS",
    ]);
    expect(parsePublicationType("notice")).toBe("notice");
    expect(parsePublicationPriority("priority")).toBe("priority");
    expect(parsePublicationLifecycle("published")).toBe("published");
    expect(parsePublicationAudienceMode("targeted")).toBe("targeted");
  });

  it("rejects unknown and prototype-like enum values", () => {
    expect(parsePublicationType("announcement")).toBeNull();
    expect(parsePublicationType("constructor")).toBeNull();
    expect(parsePublicationType("toString")).toBeNull();
    expect(parsePublicationPriority("urgent")).toBeNull();
    expect(parsePublicationPriority("constructor")).toBeNull();
    expect(parsePublicationPriority("toString")).toBeNull();
    expect(parsePublicationLifecycle("live")).toBeNull();
    expect(parsePublicationLifecycle("constructor")).toBeNull();
    expect(parsePublicationLifecycle("toString")).toBeNull();
    expect(parsePublicationAudienceMode("all")).toBeNull();
    expect(parsePublicationAudienceMode("constructor")).toBeNull();
    expect(parsePublicationAudienceMode("toString")).toBeNull();
  });

  it("accepts a valid publication", () => {
    expect(isPublication(basePublication)).toBe(true);
  });

  it("fails closed for malformed required fields and timestamps", () => {
    expect(isPublication({ ...basePublication, id: "" })).toBe(false);
    expect(isPublication({ ...basePublication, tenantId: " " })).toBe(false);
    expect(isPublication({ ...basePublication, title: "   " })).toBe(false);
    expect(isPublication({ ...basePublication, body: "" })).toBe(false);
    expect(isPublication({ ...basePublication, priority: "urgent" })).toBe(
      false,
    );
    expect(isPublication({ ...basePublication, type: "noticeboard" })).toBe(
      false,
    );
    expect(isPublication({ ...basePublication, lifecycle: "live" })).toBe(
      false,
    );
    expect(
      isPublication({ ...basePublication, audienceMode: "all" }),
    ).toBe(false);
    expect(isPublication({ ...basePublication, visibility: "PRIVATE" })).toBe(
      false,
    );
    expect(
      isPublication({ ...basePublication, authorOfficeLabel: " " }),
    ).toBe(false);
    expect(
      isPublication({ ...basePublication, publishAt: new Date("invalid") }),
    ).toBe(false);
    expect(
      isPublication({ ...basePublication, expiresAt: new Date("invalid") }),
    ).toBe(false);
    expect(isPublication({ ...basePublication, publishAt: undefined })).toBe(
      false,
    );
    expect(
      isPublication({ ...basePublication, createdAt: new Date("invalid") }),
    ).toBe(false);
    expect(
      isPublication({ ...basePublication, updatedAt: new Date("invalid") }),
    ).toBe(false);
  });
});
