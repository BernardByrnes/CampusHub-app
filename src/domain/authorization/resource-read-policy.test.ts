import { describe, expect, it } from "vitest";

import {
  ARCHIVE_NOTICE_STATES,
  authorizeResourceReadBeforeAudience,
  authorizeResourceRead,
  RESOURCE_READ_DENIAL_CODES,
  RESOURCE_VISIBILITIES,
  type ResourceAccessFacts,
  type ResourceReadPreAudienceFacts,
  type ResourceReadPreAudiencePolicyInput,
  type ResourceReadPolicyInput,
  type ResourceReadViewer,
} from "./resource-read-policy";
import type { TrustedRequestContext } from "./trusted-request-context";

const baseResource: ResourceAccessFacts = {
  resourceId: "resource-alpha",
  tenantId: "tenant-alpha",
  tenantStatus: "active",
  visibility: "PUBLIC",
  readable: true,
  publicSurfacePermitted: true,
  archiveNoticeState: undefined,
  onLeaveReadEnabled: true,
  alumniPublicReadEnabled: true,
  audience: { restricted: false },
};

const baseContext: TrustedRequestContext = {
  identitySubjectId: "identity-alpha",
  tenantId: "tenant-alpha",
  tenantStatus: "active",
  membershipId: "membership-alpha",
  assuranceLevel: "L2",
  membershipStatus: "verified",
};

const anonymousViewer: ResourceReadViewer = {
  kind: "anonymous",
  tenantId: "tenant-alpha",
};

const membershipViewer: ResourceReadViewer = {
  kind: "membership",
  context: baseContext,
};

function input(
  resourceOverrides: Partial<ResourceAccessFacts> = {},
  viewer: ResourceReadViewer = membershipViewer,
): ResourceReadPolicyInput {
  return {
    resource: { ...baseResource, ...resourceOverrides },
    viewer,
  };
}

function preAudienceInput(
  resourceOverrides: Partial<ResourceReadPreAudienceFacts> = {},
  viewer: ResourceReadViewer = membershipViewer,
): ResourceReadPreAudiencePolicyInput {
  const resource: ResourceReadPreAudienceFacts = {
    resourceId: baseResource.resourceId,
    tenantId: baseResource.tenantId,
    tenantStatus: baseResource.tenantStatus,
    visibility: baseResource.visibility,
    readable: baseResource.readable,
    publicSurfacePermitted: baseResource.publicSurfacePermitted,
    archiveNoticeState: baseResource.archiveNoticeState,
    onLeaveReadEnabled: baseResource.onLeaveReadEnabled,
    alumniPublicReadEnabled: baseResource.alumniPublicReadEnabled,
    ...resourceOverrides,
  };

  return { resource, viewer };
}

function expectDenied(
  result: ReturnType<typeof authorizeResourceRead>,
  code: (typeof RESOURCE_READ_DENIAL_CODES)[number],
) {
  expect(result).toEqual({ allowed: false, code });
}

describe("resource-read authorization contract", () => {
  it("defines only the canonical visibility and archive values", () => {
    expect(RESOURCE_VISIBILITIES).toEqual([
      "PUBLIC",
      "MEMBERS",
      "VERIFIED_MEMBERS",
    ]);
    expect(ARCHIVE_NOTICE_STATES).toEqual(["ACTIVE", "ENDED"]);
    expect(RESOURCE_READ_DENIAL_CODES).toEqual([
      "INVALID_INPUT",
      "TENANT_SCOPE_NOT_FOUND",
      "TENANT_UNAVAILABLE",
      "RESOURCE_NOT_AVAILABLE",
      "PUBLIC_SURFACE_UNAVAILABLE",
      "MEMBERSHIP_REQUIRED",
      "MEMBERSHIP_NOT_ELIGIBLE",
      "ASSURANCE_INSUFFICIENT",
      "AUDIENCE_INELIGIBLE",
    ]);
  });

  it("allows anonymous PUBLIC reads only inside an explicit permitted Tenant", () => {
    expect(authorizeResourceRead(input({}, anonymousViewer))).toEqual({
      allowed: true,
    });
    expectDenied(
      authorizeResourceRead(
        input({ visibility: "MEMBERS" }, anonymousViewer),
      ),
      "MEMBERSHIP_REQUIRED",
    );
    expectDenied(
      authorizeResourceRead(
        input({ visibility: "VERIFIED_MEMBERS" }, anonymousViewer),
      ),
      "MEMBERSHIP_REQUIRED",
    );
    expectDenied(
      authorizeResourceRead(
        input({ publicSurfacePermitted: false }, anonymousViewer),
      ),
      "PUBLIC_SURFACE_UNAVAILABLE",
    );
  });

  it.each([
    ["pilot", undefined, true],
    ["active", undefined, true],
    ["grace", undefined, true],
    ["suspended", undefined, true],
    ["archived", "ACTIVE", true],
    ["archived", "ENDED", false],
  ] as const)(
    "applies the %s Tenant read state with notice %s",
    (tenantStatus, archiveNoticeState, allowed) => {
      const viewer: ResourceReadViewer = {
        kind: "membership",
        context: { ...baseContext, tenantStatus },
      };
      const result = authorizeResourceRead(
        input({
          tenantStatus,
          archiveNoticeState,
          visibility: "MEMBERS",
        }, viewer),
      );

      if (allowed) {
        expect(result).toEqual({ allowed: true });
      } else {
        expectDenied(result, "TENANT_UNAVAILABLE");
      }
    },
  );

  it("keeps suspended Tenant reads limited to existing readable content", () => {
    const viewer: ResourceReadViewer = {
      kind: "membership",
      context: { ...baseContext, tenantStatus: "suspended" },
    };
    expect(
      authorizeResourceRead(
        input({ tenantStatus: "suspended", readable: true }, viewer),
      ),
    ).toEqual({ allowed: true });
    expectDenied(
      authorizeResourceRead(
        input({ tenantStatus: "suspended", readable: false }, viewer),
      ),
      "RESOURCE_NOT_AVAILABLE",
    );
  });

  it("requires an explicit archive notice state for archived Tenants", () => {
    expectDenied(
      authorizeResourceRead(
        input({ tenantStatus: "archived", archiveNoticeState: undefined }),
      ),
      "INVALID_INPUT",
    );
    expectDenied(
      authorizeResourceRead(
        input({
          tenantStatus: "archived",
          archiveNoticeState: "MALFORMED" as never,
        }),
      ),
      "INVALID_INPUT",
    );
  });

  it.each([
    ["unverified", true, true, true],
    ["pending_review", true, true, true],
    ["verified", true, true, true],
    ["stale", true, true, true],
    ["on_leave", true, true, true],
    ["alumni", true, false, false],
    ["transferred_out", true, false, false],
    ["participation_suspended", true, true, true],
    ["suspended", false, false, false],
    ["closed", true, false, false],
  ] as const)(
    "%s follows the approved PUBLIC/MEMBERS/VERIFIED_MEMBERS matrix",
    (membershipStatus, publicAllowed, membersAllowed, verifiedMembersAllowed) => {
      const viewer: ResourceReadViewer = {
        kind: "membership",
        context: { ...baseContext, membershipStatus },
      };

      const publicResult = authorizeResourceRead(input({}, viewer));
      if (publicAllowed) {
        expect(publicResult).toEqual({ allowed: true });
      } else {
        expectDenied(publicResult, "MEMBERSHIP_NOT_ELIGIBLE");
      }

      const membersResult = authorizeResourceRead(
        input({ visibility: "MEMBERS" }, viewer),
      );
      if (membersAllowed) {
        expect(membersResult).toEqual({ allowed: true });
      } else {
        expectDenied(membersResult, "MEMBERSHIP_NOT_ELIGIBLE");
      }

      const verifiedMembersResult = authorizeResourceRead(
        input({ visibility: "VERIFIED_MEMBERS" }, viewer),
      );
      if (verifiedMembersAllowed) {
        expect(verifiedMembersResult).toEqual({ allowed: true });
      } else {
        expectDenied(verifiedMembersResult, "MEMBERSHIP_NOT_ELIGIBLE");
      }
    },
  );

  it("keeps on_leave configuration separate from participation", () => {
    const viewer: ResourceReadViewer = {
      kind: "membership",
      context: { ...baseContext, membershipStatus: "on_leave" },
    };

    expect(
      authorizeResourceRead(
        input({ visibility: "MEMBERS", onLeaveReadEnabled: true }, viewer),
      ),
    ).toEqual({ allowed: true });
    expectDenied(
      authorizeResourceRead(
        input({ visibility: "MEMBERS", onLeaveReadEnabled: false }, viewer),
      ),
      "MEMBERSHIP_NOT_ELIGIBLE",
    );
    expect(
      authorizeResourceRead(
        input({
          visibility: "PUBLIC",
          onLeaveReadEnabled: false,
        }, viewer),
      ),
    ).toEqual({ allowed: true });
  });

  it("keeps alumni PUBLIC-only and configuration-controlled", () => {
    const viewer: ResourceReadViewer = {
      kind: "membership",
      context: { ...baseContext, membershipStatus: "alumni" },
    };

    expect(
      authorizeResourceRead(
        input({ visibility: "PUBLIC", alumniPublicReadEnabled: true }, viewer),
      ),
    ).toEqual({ allowed: true });
    expectDenied(
      authorizeResourceRead(
        input({ visibility: "PUBLIC", alumniPublicReadEnabled: false }, viewer),
      ),
      "MEMBERSHIP_NOT_ELIGIBLE",
    );
    expectDenied(
      authorizeResourceRead(
        input({ visibility: "MEMBERS" }, viewer),
      ),
      "MEMBERSHIP_NOT_ELIGIBLE",
    );
    expectDenied(
      authorizeResourceRead(
        input({ visibility: "VERIFIED_MEMBERS" }, viewer),
      ),
      "MEMBERSHIP_NOT_ELIGIBLE",
    );
  });

  it("allows terminal Memberships PUBLIC content only through public-view semantics", () => {
    for (const membershipStatus of ["transferred_out", "closed"] as const) {
      const viewer: ResourceReadViewer = {
        kind: "membership",
        context: { ...baseContext, membershipStatus },
      };

      expect(authorizeResourceRead(input({}, viewer))).toEqual({
        allowed: true,
      });
      expectDenied(
        authorizeResourceRead(
          input({ visibility: "MEMBERS" }, viewer),
        ),
        "MEMBERSHIP_NOT_ELIGIBLE",
      );
      expectDenied(
        authorizeResourceRead(
          input({ visibility: "VERIFIED_MEMBERS" }, viewer),
        ),
        "MEMBERSHIP_NOT_ELIGIBLE",
      );
    }
  });

  it.each([
    ["L0", "MEMBERS", false],
    ["L1", "MEMBERS", true],
    ["L1", "VERIFIED_MEMBERS", false],
    ["L2", "VERIFIED_MEMBERS", true],
    ["L3", "VERIFIED_MEMBERS", true],
  ] as const)(
    "uses canonical assurance ranking: %s on %s",
    (assuranceLevel, visibility, allowed) => {
      const viewer: ResourceReadViewer = {
        kind: "membership",
        context: { ...baseContext, assuranceLevel },
      };
      const result = authorizeResourceRead(input({ visibility }, viewer));

      if (allowed) {
        expect(result).toEqual({ allowed: true });
      } else {
        expectDenied(result, "ASSURANCE_INSUFFICIENT");
      }
    },
  );

  it("enforces pre-evaluated audience eligibility after visibility and assurance", () => {
    expect(
      authorizeResourceRead(
        input({ audience: { restricted: false } }),
      ),
    ).toEqual({ allowed: true });
    expect(
      authorizeResourceRead(
        input({
          visibility: "VERIFIED_MEMBERS",
          audience: { restricted: true, eligible: true },
        }),
      ),
    ).toEqual({ allowed: true });
    expectDenied(
      authorizeResourceRead(
        input({
          visibility: "VERIFIED_MEMBERS",
          audience: { restricted: true, eligible: false },
        }),
      ),
      "AUDIENCE_INELIGIBLE",
    );
  });

  it("allows pre-audience authorization without an audience result", () => {
    expect(authorizeResourceReadBeforeAudience(preAudienceInput())).toEqual({
      allowed: true,
    });
  });

  it.each([
    ["Tenant mismatch", { tenantId: "tenant-beta" }, "TENANT_SCOPE_NOT_FOUND"],
    ["invalid Tenant state", { tenantStatus: "archived", archiveNoticeState: undefined }, "INVALID_INPUT"],
    ["unavailable Tenant", { tenantStatus: "archived", archiveNoticeState: "ENDED" }, "TENANT_UNAVAILABLE"],
    ["unreadable resource", { readable: false }, "RESOURCE_NOT_AVAILABLE"],
    ["anonymous member-only visibility", { visibility: "MEMBERS" }, "MEMBERSHIP_REQUIRED"],
    ["insufficient assurance", { visibility: "VERIFIED_MEMBERS" }, "ASSURANCE_INSUFFICIENT"],
  ] as const)(
    "shares the %s result between pre-audience and full policy",
    (label, resourceOverrides, expectedCode) => {
      const viewer =
        label === "anonymous member-only visibility"
          ? anonymousViewer
          : label === "insufficient assurance"
            ? {
                ...membershipViewer,
                context: { ...baseContext, assuranceLevel: "L1" as const },
              }
            : membershipViewer;
      const preAudienceResult = authorizeResourceReadBeforeAudience(
        preAudienceInput(resourceOverrides, viewer),
      );
      const fullResult = authorizeResourceRead(
        input(
          {
            ...resourceOverrides,
            audience: { restricted: true, eligible: false },
          },
          viewer,
        ),
      );

      expect(preAudienceResult).toEqual({
        allowed: false,
        code: expectedCode,
      });
      expect(fullResult).toEqual(preAudienceResult);
    },
  );

  it("fails closed for unreadable resources", () => {
    expectDenied(
      authorizeResourceRead(input({ readable: false })),
      "RESOURCE_NOT_AVAILABLE",
    );
  });

  it("denies cross-Tenant resources as not-found-equivalent", () => {
    const foreignMembershipViewer: ResourceReadViewer = {
      kind: "membership",
      context: { ...baseContext, tenantId: "tenant-beta" },
    };
    const foreignAnonymousViewer: ResourceReadViewer = {
      kind: "anonymous",
      tenantId: "tenant-beta",
    };

    expectDenied(
      authorizeResourceRead(input({}, foreignMembershipViewer)),
      "TENANT_SCOPE_NOT_FOUND",
    );
    expectDenied(
      authorizeResourceRead(input({}, foreignAnonymousViewer)),
      "TENANT_SCOPE_NOT_FOUND",
    );
  });

  it("fails closed when trusted and resource Tenant lifecycle facts disagree", () => {
    expectDenied(
      authorizeResourceRead(
        input({ tenantStatus: "suspended" }, membershipViewer),
      ),
      "TENANT_UNAVAILABLE",
    );
  });

  it("uses security-safe precedence", () => {
    expectDenied(
      authorizeResourceRead({
        resource: {
          ...baseResource,
          tenantId: "tenant-alpha",
          visibility: "INVALID" as never,
        },
        viewer: {
          kind: "anonymous",
          tenantId: "tenant-beta",
        },
      }),
      "INVALID_INPUT",
    );

    expectDenied(
      authorizeResourceRead(
        input({
          tenantStatus: "archived",
          archiveNoticeState: "ENDED",
          readable: false,
        }, {
          kind: "membership",
          context: { ...baseContext, tenantId: "tenant-beta", tenantStatus: "archived" },
        }),
      ),
      "TENANT_SCOPE_NOT_FOUND",
    );

    expectDenied(
      authorizeResourceRead(
        input({
          tenantStatus: "archived",
          archiveNoticeState: "ENDED",
          readable: false,
        }),
      ),
      "TENANT_UNAVAILABLE",
    );

    expectDenied(
      authorizeResourceRead(
        input({
          visibility: "PUBLIC",
          publicSurfacePermitted: false,
        }, {
          kind: "membership",
          context: { ...baseContext, membershipStatus: "suspended" },
        }),
      ),
      "MEMBERSHIP_NOT_ELIGIBLE",
    );

    expectDenied(
      authorizeResourceRead(
        input({
          visibility: "MEMBERS",
          audience: { restricted: true, eligible: false },
        }, {
          kind: "membership",
          context: { ...baseContext, assuranceLevel: "L0" },
        }),
      ),
      "ASSURANCE_INSUFFICIENT",
    );
  });

  it.each([
    {
      resource: { ...baseResource, visibility: "PRIVATE" },
      viewer: membershipViewer,
    },
    {
      resource: { ...baseResource, tenantStatus: "UNKNOWN" },
      viewer: membershipViewer,
    },
    {
      resource: { ...baseResource, audience: { restricted: true } },
      viewer: membershipViewer,
    },
    {
      resource: { ...baseResource, readable: "yes" },
      viewer: membershipViewer,
    },
    {
      resource: { ...baseResource, publicSurfacePermitted: 1 },
      viewer: membershipViewer,
    },
    {
      resource: { ...baseResource, onLeaveReadEnabled: "yes" },
      viewer: membershipViewer,
    },
    {
      resource: { ...baseResource, alumniPublicReadEnabled: "yes" },
      viewer: membershipViewer,
    },
    {
      resource: { ...baseResource, tenantStatus: "archived" },
      viewer: membershipViewer,
    },
    {
      resource: { ...baseResource, tenantStatus: "archived", archiveNoticeState: "LATER" },
      viewer: membershipViewer,
    },
    {
      resource: { ...baseResource, tenantStatus: "active" },
      viewer: {
        kind: "membership",
        context: { ...baseContext, assuranceLevel: "L4" },
      },
    },
    {
      resource: { ...baseResource, tenantStatus: "active" },
      viewer: {
        kind: "membership",
        context: { ...baseContext, membershipStatus: "constructor" },
      },
    },
    {
      resource: baseResource,
      viewer: { kind: "anonymous" },
    },
  ] as const)("rejects malformed input %#", (candidate) => {
    expectDenied(
      authorizeResourceRead(candidate as unknown as ResourceReadPolicyInput),
      "INVALID_INPUT",
    );
  });
});
