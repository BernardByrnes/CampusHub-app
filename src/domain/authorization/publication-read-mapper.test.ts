import { describe, expect, it } from "vitest";

import type { Publication } from "@/domain/content/publication";

import { mapPublicationToResourceAccessFacts } from "./publication-read-mapper";
import type {
  PublicationAudienceDecision,
  ResolvedTenantReadFacts,
} from "./publication-read-contract";

const now = new Date("2026-01-15T12:00:00.000Z");

const basePublication: Publication = {
  id: "publication-alpha",
  tenantId: "tenant-alpha",
  type: "news",
  title: "Campus update",
  body: "The campus update body.",
  priority: "standard",
  visibility: "MEMBERS",
  lifecycle: "published",
  audienceMode: "entire_tenant",
  authorOfficeLabel: "Guild Communications Office",
  publishAt: new Date("2026-01-10T12:00:00.000Z"),
  expiresAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const baseTenantFacts: ResolvedTenantReadFacts = {
  tenantStatus: "active",
  publicSurfacePermitted: true,
  onLeaveReadEnabled: true,
  alumniPublicReadEnabled: true,
};

function map(
  publication: Publication = basePublication,
  tenantFacts: ResolvedTenantReadFacts = baseTenantFacts,
  contentExposure: "READABLE" | "SUPPRESSED" = "READABLE",
  audienceDecision?: PublicationAudienceDecision,
) {
  return mapPublicationToResourceAccessFacts(
    publication,
    tenantFacts,
    contentExposure,
    audienceDecision,
    now,
  );
}

describe("Publication read mapper", () => {
  it("maps an entire-Tenant Publication to unrestricted readable facts", () => {
    expect(map()).toEqual({
      resourceId: "publication-alpha",
      tenantId: "tenant-alpha",
      tenantStatus: "active",
      visibility: "MEMBERS",
      readable: true,
      publicSurfacePermitted: true,
      archiveNoticeState: undefined,
      onLeaveReadEnabled: true,
      alumniPublicReadEnabled: true,
      audience: { restricted: false },
    });
  });

  it.each([
    ["draft", new Date("2026-01-10T12:00:00.000Z"), false],
    ["scheduled", new Date("2026-01-20T12:00:00.000Z"), false],
    ["scheduled", new Date("2026-01-10T12:00:00.000Z"), false],
    ["published", null, false],
    ["published", new Date("2026-01-20T12:00:00.000Z"), false],
    ["published", new Date("2026-01-10T12:00:00.000Z"), true],
    ["expired", new Date("2026-01-10T12:00:00.000Z"), true],
    ["archived", new Date("2026-01-10T12:00:00.000Z"), true],
  ] as const)(
    "maps lifecycle %s with publishAt %s to readable=%s",
    (lifecycle, publishAt, readable) => {
      const result = map({
        ...basePublication,
        lifecycle,
        publishAt,
        expiresAt:
          lifecycle === "expired"
            ? new Date("2026-01-11T12:00:00.000Z")
            : null,
      });

      expect(result?.readable).toBe(readable);
    },
  );

  it("suppresses content without discarding its lifecycle facts", () => {
    expect(map(basePublication, baseTenantFacts, "SUPPRESSED")).toMatchObject({
      readable: false,
    });
  });

  it("requires and preserves an evaluated decision for targeted audience mode", () => {
    const targeted = { ...basePublication, audienceMode: "targeted" as const };

    expect(map(targeted, baseTenantFacts, "READABLE", {
      evaluated: true,
      eligible: true,
    })).toMatchObject({
      audience: { restricted: true, eligible: true },
      readable: true,
    });
    expect(map(targeted, baseTenantFacts, "READABLE", {
      evaluated: true,
      eligible: false,
    })).toMatchObject({
      audience: { restricted: true, eligible: false },
    });
    expect(map(targeted)).toBeNull();
  });

  it("fails closed for malformed trusted inputs and missing archived notice", () => {
    expect(
      map(basePublication, {
        ...baseTenantFacts,
        publicSurfacePermitted: "yes",
      } as unknown as ResolvedTenantReadFacts),
    ).toBeNull();
    expect(
      map(basePublication, baseTenantFacts, "UNKNOWN" as never),
    ).toBeNull();
    expect(
      map(
        { ...basePublication, audienceMode: "targeted" as const },
        baseTenantFacts,
        "READABLE",
        { evaluated: false, eligible: true } as never,
      ),
    ).toBeNull();
    expect(
      map({ ...basePublication, audienceMode: "unknown" } as unknown as Publication),
    ).toBeNull();
    expect(
      map({ ...basePublication, lifecycle: "archived" }, {
        ...baseTenantFacts,
        tenantStatus: "archived",
      }),
    ).toBeNull();
    expect(map(basePublication, baseTenantFacts, "READABLE", undefined)).not.toBeNull();
    expect(
      map(basePublication, baseTenantFacts, "READABLE", null as never),
    ).toBeNull();
  });

  it("does not mutate the Publication or trusted facts", () => {
    const publication = { ...basePublication };
    const tenantFacts = { ...baseTenantFacts };
    const publicationBefore = { ...publication };
    const tenantFactsBefore = { ...tenantFacts };

    map(publication, tenantFacts);

    expect(publication).toEqual(publicationBefore);
    expect(tenantFacts).toEqual(tenantFactsBefore);
  });
});
