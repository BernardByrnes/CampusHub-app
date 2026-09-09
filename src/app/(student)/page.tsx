import { connection } from "next/server";

import type {
  CampusHomeFeedResult,
  CampusHomeRequest,
} from "@/application/content/campus-home";

import { CampusHomePage } from "@/components/campus-home/campus-home-page";
import {
  CampusHomeErrorState,
  CampusHomeUnavailableState,
} from "@/components/campus-home/home-states";

type StudentHomePageProps = Readonly<{
  searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}>;

/**
 * Auth/session production work is intentionally outside CH-HOM-001. This is
 * the server-only seam where a future trusted identity producer must supply
 * RequestContext facts; no browser header, cookie, or query value is trusted.
 */
async function resolveTrustedHomeRequest(): Promise<CampusHomeRequest | null> {
  return null;
}

function cursorFromSearchParams(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string | null {
  const value = searchParams?.cursor;
  return typeof value === "string" ? value : null;
}

async function loadCampusHomeFeed(
  trustedRequest: CampusHomeRequest,
  searchParams: StudentHomePageProps["searchParams"],
): Promise<CampusHomeFeedResult | null> {
  try {
    const { createCampusHomeService } = await import(
      "@/server/home/create-campus-home-service"
    );
    return await createCampusHomeService().getFeed({
      ...trustedRequest,
      cursor: cursorFromSearchParams(await searchParams),
      now: new Date(),
    });
  } catch {
    return null;
  }
}

export default async function StudentHomePage({
  searchParams,
}: StudentHomePageProps) {
  await connection();

  const trustedRequest = await resolveTrustedHomeRequest();
  if (trustedRequest === null) {
    return <CampusHomeUnavailableState />;
  }

  const result = await loadCampusHomeFeed(trustedRequest, searchParams);
  if (result === null || result.outcome !== "READY") {
    return <CampusHomeErrorState />;
  }

  return (
    <CampusHomePage
      tenantDisplayName={result.tenantDisplayName}
      items={result.items}
      nextCursor={result.nextCursor}
    />
  );
}
