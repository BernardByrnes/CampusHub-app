import "server-only";

import type {
  PublicationAudienceDecision,
  PublicationContentExposure,
} from "@/domain/authorization/publication-read-contract";
import type { ResourceReadViewer } from "@/domain/authorization/resource-read-policy";
import type { Publication } from "@/domain/content/publication";

/** Server-owned facts required to expose a hydrated Publication to readers. */
export type PublicationExposureResolver = Readonly<{
  resolveExposure(
    publications: readonly Publication[],
  ): Promise<ReadonlyMap<string, PublicationContentExposure>> |
    ReadonlyMap<string, PublicationContentExposure>;
}>;

/** Server-owned targeted-audience evaluation; no client decision is accepted. */
export type PublicationAudienceResolver = Readonly<{
  resolveAudience(
    input: Readonly<{
      publication: Publication;
      viewer: ResourceReadViewer;
    }>,
  ): Promise<PublicationAudienceDecision> | PublicationAudienceDecision;
}>;
