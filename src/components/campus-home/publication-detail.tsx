import Link from "next/link";

import type { CampusHomePublicationDetail } from "@/application/content/campus-home";

export function PublicationDetail({
  publication,
}: Readonly<{ publication: CampusHomePublicationDetail }>) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 sm:py-10">
      <article className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <Link
          className="inline-flex min-h-11 items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-950 underline-offset-4 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-950"
          href="/"
        >
          Back to Campus Home
        </Link>
        <p className="mt-8 text-sm font-semibold uppercase tracking-[0.16em] text-slate-600">
          {publication.type === "notice" ? "Notice" : "News"}
          {publication.priority === "priority" ? " · Priority" : ""}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          {publication.title}
        </h1>
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
          <span>{publication.authorOfficeLabel}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={publication.publishedAt.toISOString()}>
            {publication.publishedAtLabel}
          </time>
        </div>
        <div className="mt-8 whitespace-pre-wrap text-base leading-8 text-slate-800">
          {publication.body}
        </div>
      </article>
    </main>
  );
}
