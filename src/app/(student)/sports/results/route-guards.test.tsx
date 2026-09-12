import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  repositoryModuleEvaluated: false,
  repositoryConstructed: false,
  persistenceQueries: 0,
}));

vi.mock("next/server", () => ({
  connection: vi.fn(async () => undefined),
}));

vi.mock("@/components/sports/result-surfaces", () => ({
  StudentResultsPage: () => ({ kind: "student-results" }),
  StudentResultHistoryPage: () => ({ kind: "student-result-history" }),
}));

vi.mock("@/server/repositories/result-repository", () => {
  state.repositoryModuleEvaluated = true;
  return {
    DrizzleResultRepository: class {
      public constructor() {
        state.repositoryConstructed = true;
      }

      public async listPublishedResultsForTenant() {
        state.persistenceQueries += 1;
        return [];
      }

      public async listResultRevisionsForTenant() {
        state.persistenceQueries += 1;
        return { ok: true as const, items: [] };
      }
    },
  };
});

function resetState(): void {
  state.repositoryModuleEvaluated = false;
  state.repositoryConstructed = false;
  state.persistenceQueries = 0;
}

function expectUnavailable(output: unknown): void {
  expect(output).toMatchObject({ type: expect.any(Function) });
  expect((output as { type?: { name?: string } }).type?.name).toBe("CampusHomeUnavailableState");
}

describe("Student Result route trusted-context guards", () => {
  beforeEach(resetState);

  it("keeps the list route unavailable without evaluating or constructing the Result repository", async () => {
    const { default: route } = await import("./page");

    expectUnavailable(await route({ searchParams: Promise.resolve({}) }));
    expect(state.repositoryModuleEvaluated).toBe(false);
    expect(state.repositoryConstructed).toBe(false);
    expect(state.persistenceQueries).toBe(0);
  });

  it("keeps the history route unavailable without evaluating or constructing the Result repository", async () => {
    const { default: route } = await import("./[resultId]/history/page");

    expectUnavailable(await route({ params: Promise.resolve({ resultId: "00000000-0000-4000-8000-000000000001" }) }));
    expect(state.repositoryModuleEvaluated).toBe(false);
    expect(state.repositoryConstructed).toBe(false);
    expect(state.persistenceQueries).toBe(0);
  });
});
