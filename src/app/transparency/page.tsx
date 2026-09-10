import type { Metadata } from "next";

import { TransparencyPage } from "@/components/transparency/transparency-page";

export const metadata: Metadata = {
  title: "Transparency | CampusHub",
  description: "Plain-language information about CampusHub and student data.",
};

/**
 * This public route intentionally has no Auth or Tenant dependency. A future
 * reviewed deployment may inject narrow local disclosure content without
 * turning the page into a public Tenant selector.
 */
export default function TransparencyRoute() {
  return <TransparencyPage />;
}
