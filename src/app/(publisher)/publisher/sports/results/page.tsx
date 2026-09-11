import { connection } from "next/server";

import { PublisherResultsManagementPage } from "@/components/sports/result-surfaces";

async function resolveTrustedPublisherResultContext(): Promise<null> {
  return null;
}

export default async function PublisherResultsRoute() {
  await connection();
  await resolveTrustedPublisherResultContext();
  return <PublisherResultsManagementPage />;
}
