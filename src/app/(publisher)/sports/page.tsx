import { connection } from "next/server";

import { SportsManagementPage } from "@/components/sports/sports-management-page";

/**
 * The authenticated Publisher transport is intentionally deferred. This
 * server-only seam must later return facts from the trusted identity/session
 * producer; browser parameters, cookies, and headers are not accepted here.
 */
async function resolveTrustedPublisherSportsContext(): Promise<null> {
  return null;
}

export default async function PublisherSportsPage() {
  await connection();
  await resolveTrustedPublisherSportsContext();
  return <SportsManagementPage />;
}
