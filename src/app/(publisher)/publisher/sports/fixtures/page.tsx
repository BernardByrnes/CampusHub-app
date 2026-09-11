import { connection } from "next/server";

import { PublisherFixturesManagementPage } from "@/components/sports/fixture-surfaces";

async function resolveTrustedPublisherFixtureContext(): Promise<null> {
  return null;
}

export default async function PublisherFixturesRoute() {
  await connection();
  await resolveTrustedPublisherFixtureContext();
  return <PublisherFixturesManagementPage />;
}
