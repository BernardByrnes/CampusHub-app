import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ db: {}, pool: {} }));

import { DrizzleTeamRepository } from "./team-repository";

const tenantId = "00000000-0000-4000-8000-000000000001";
const sportId = "00000000-0000-4000-8000-000000000002";
const teamId = "00000000-0000-4000-8000-000000000003";

describe("DrizzleTeamRepository affiliation validation", () => {
  it("rejects a blank affiliation on create before SQL", async () => {
    const repository = new DrizzleTeamRepository({} as never);

    await expect(
      repository.createTeamInTransaction({} as never, tenantId, {
        sportId,
        name: "Campus United",
        affiliationLabel: " ",
      }),
    ).resolves.toEqual({ ok: false, error: "PERSISTENCE_FAILED" });
  });

  it("rejects an oversized affiliation on update before SQL", async () => {
    const repository = new DrizzleTeamRepository({} as never);

    await expect(
      repository.updateTeamInTransaction({} as never, tenantId, teamId, {
        expectedVersion: 1,
        sportId,
        name: "Campus United",
        affiliationLabel: "x".repeat(161),
      }),
    ).resolves.toEqual({ ok: false, error: "PERSISTENCE_FAILED" });
  });
});
