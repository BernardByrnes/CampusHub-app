import { connection } from "next/server";

import { StudentFixturesPage } from "@/components/sports/fixture-surfaces";
import { CampusHomeUnavailableState } from "@/components/campus-home/home-states";
import type { CampusHomeRequest } from "@/application/content/campus-home";
import type { FixtureReadResult } from "@/application/sports/list-fixtures";

type FixturePageProps = Readonly<{
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}>;

async function resolveTrustedStudentSportsContext(): Promise<CampusHomeRequest | null> {
  return null;
}

function singleValue(
  params: Record<string, string | string[] | undefined> | undefined,
  key: string,
): string | undefined {
  const value = params?.[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

export default async function StudentFixturesRoute({ searchParams }: FixturePageProps) {
  await connection();
  const trustedRequest = await resolveTrustedStudentSportsContext();
  if (trustedRequest === null) {
    return <CampusHomeUnavailableState />;
  }
  const params = await searchParams;
  let result: FixtureReadResult;
  try {
    const { createListFixturesService } = await import("@/server/sports/create-fixture-services");
    result = await createListFixturesService().listFixtures({
      trustedContext: trustedRequest.context,
      requestedTenantId: trustedRequest.context.tenantId,
      filters: {
        sportName: singleValue(params, "sport"),
        competitionName: singleValue(params, "competition"),
        teamName: singleValue(params, "team"),
        state: singleValue(params, "state"),
      },
    });
  } catch {
    return <CampusHomeUnavailableState />;
  }
  return result.outcome === "READY" ? <StudentFixturesPage items={result.items} selectedSport={singleValue(params, "sport")} selectedCompetition={singleValue(params, "competition")} selectedTeam={singleValue(params, "team")} /> : <CampusHomeUnavailableState />;
}
