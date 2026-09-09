import { connection } from "next/server";
import { notFound } from "next/navigation";

import type {
  CampusHomeDetailResult,
  CampusHomeRequest,
} from "@/application/content/campus-home";

import { CampusHomeErrorState } from "@/components/campus-home/home-states";
import { PublicationDetail } from "@/components/campus-home/publication-detail";

type PublicationDetailPageProps = Readonly<{
  params: Promise<{ publicationId: string }>;
}>;

/**
 * This uses the same server-only trusted-context seam as Home. The detail
 * service independently reauthorizes the exact Publication before rendering.
 */
async function resolveTrustedHomeRequest(): Promise<CampusHomeRequest | null> {
  return null;
}

async function loadPublicationDetail(
  trustedRequest: CampusHomeRequest,
  publicationId: string,
): Promise<CampusHomeDetailResult | null> {
  try {
    const { createCampusHomeService } = await import(
      "@/server/home/create-campus-home-service"
    );
    return await createCampusHomeService().getDetail({
      ...trustedRequest,
      publicationId,
      now: new Date(),
    });
  } catch {
    return null;
  }
}

export default async function PublicationDetailPage({
  params,
}: PublicationDetailPageProps) {
  await connection();

  const trustedRequest = await resolveTrustedHomeRequest();
  if (trustedRequest === null) {
    notFound();
  }

  const { publicationId } = await params;
  const result = await loadPublicationDetail(trustedRequest, publicationId);
  if (result === null) {
    return <CampusHomeErrorState />;
  }
  if (result.outcome !== "FOUND") {
    notFound();
  }

  return <PublicationDetail publication={result.publication} />;
}
