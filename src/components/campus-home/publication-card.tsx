import Link from "next/link";

import type { CampusHomePublicationCard } from "@/application/content/campus-home";

const publicationTypeLabels = {
  notice: "Notice",
  news: "News",
} as const;

export function PublicationCard({
  publication,
}: Readonly<{ publication: CampusHomePublicationCard }>) {
  const priority = publication.priority === "priority";

  return (
    <article
      className={`rounded-2xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md sm:p-6 ${
        priority
          ? "border-amber-300 ring-1 ring-amber-100"
          : "border-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
        <span>{publicationTypeLabels[publication.type]}</span>
        {priority ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-950">
            Priority
          </span>
        ) : null}
      </div>
      <h3 className="mt-3 text-xl font-semibold tracking-tight text-slate-950">
        <Link
          className="rounded-sm underline decoration-slate-300 underline-offset-4 hover:decoration-slate-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-950"
          href={`/publications/${encodeURIComponent(publication.id)}`}
        >
          {publication.title}
        </Link>
      </h3>
      <p className="mt-3 text-base leading-7 text-slate-700">
        {publication.excerpt}
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
        <span>{publication.authorOfficeLabel}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={publication.publishedAt.toISOString()}>
          {publication.publishedAtLabel}
        </time>
      </div>
    </article>
  );
}
