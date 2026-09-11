import { connection } from "next/server";

import type { CampusHomeRequest } from "@/application/content/campus-home";
import {
  ListResultsService,
  type ResultReadResult,
} from "@/application/sports/list-results";
import { CampusHomeUnavailableState } from "@/components/campus-home/home-states";
import { StudentResultHistoryPage } from "@/components/sports/result-surfaces";
import { DrizzleResultRepository } from "@/server/repositories/result-repository";

type ResultHistoryPageProps = Readonly<{
  params: Promise<{ resultId: string }>;
}>;

async function resolveTrustedStudentSportsContext(): Promise<CampusHomeRequest | null> {
  return null;
}

export default async function StudentResultHistoryRoute({
  params,
}: ResultHistoryPageProps) {
  await connection();
  const trustedRequest = await resolveTrustedStudentSportsContext();
  if (trustedRequest === null) return <CampusHomeUnavailableState />;

  const { resultId } = await params;
  const service = new ListResultsService({
    results: new DrizzleResultRepository(),
  });
  let history: ResultReadResult;
  try {
    history = await service.listCorrectionHistory({
      trustedContext: trustedRequest.context,
      requestedTenantId: trustedRequest.context.tenantId,
      resultId,
    });
  } catch {
    return <CampusHomeUnavailableState />;
  }
  if (history.outcome !== "HISTORY") {
    return <CampusHomeUnavailableState />;
  }
  return (
    <StudentResultHistoryPage
      resultLabel="Published Result correction history"
      history={history.items}
    />
  );
}
