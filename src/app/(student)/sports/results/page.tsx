import { connection } from "next/server";

import type { CampusHomeRequest } from "@/application/content/campus-home";
import { ListResultsService, type ResultReadResult } from "@/application/sports/list-results";
import { CampusHomeUnavailableState } from "@/components/campus-home/home-states";
import { StudentResultsPage } from "@/components/sports/result-surfaces";
import { DrizzleResultRepository } from "@/server/repositories/result-repository";

type ResultPageProps = Readonly<{
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
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

export default async function StudentResultsRoute({ searchParams }: ResultPageProps) {
  await connection();
  const trustedRequest = await resolveTrustedStudentSportsContext();
  if (trustedRequest === null) return <CampusHomeUnavailableState />;
  const params = await searchParams;
  let result: ResultReadResult;
  try {
    const service = new ListResultsService({ results: new DrizzleResultRepository() });
    result = await service.listResults({
      trustedContext: trustedRequest.context,
      requestedTenantId: trustedRequest.context.tenantId,
      filters: {
        sportName: singleValue(params, "sport"),
        competitionName: singleValue(params, "competition"),
        teamName: singleValue(params, "team"),
      },
    });
  } catch {
    return <CampusHomeUnavailableState />;
  }
  return result.outcome === "READY" ? <StudentResultsPage items={result.items} selectedSport={singleValue(params, "sport")} selectedCompetition={singleValue(params, "competition")} selectedTeam={singleValue(params, "team")} /> : <CampusHomeUnavailableState />;
}
