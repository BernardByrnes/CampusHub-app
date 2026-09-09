import Link from "next/link";

import type { CampusHomePublicationCard } from "@/application/content/campus-home";

import { PublicationCard } from "./publication-card";

export function PublicationFeed({
  items,
  nextCursor,
}: Readonly<{
  items: readonly CampusHomePublicationCard[];
  nextCursor: string | null;
}>) {
  return (
    <section aria-labelledby="campus-updates-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-600">
            Published for you
          </p>
          <h2
            className="mt-2 text-2xl font-semibold tracking-tight text-slate-950"
            id="campus-updates-heading"
          >
            Campus updates
          </h2>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-base leading-7 text-slate-700">
          Nothing new has been published for you yet.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4" aria-label="Campus publications">
          {items.map((publication) => (
            <li key={publication.id}>
              <PublicationCard publication={publication} />
            </li>
          ))}
        </ul>
      )}

      {nextCursor ? (
        <div className="mt-6">
          <Link
            className="inline-flex min-h-11 items-center rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-950 underline-offset-4 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-950"
            href={`/?cursor=${encodeURIComponent(nextCursor)}`}
          >
            Load more
          </Link>
        </div>
      ) : null}
    </section>
  );
}
