import type { CampusHomePublicationCard } from "@/application/content/campus-home";

import { PublicationFeed } from "./publication-feed";

export function CampusHomePage({
  tenantDisplayName,
  items,
  nextCursor,
}: Readonly<{
  tenantDisplayName: string;
  items: readonly CampusHomePublicationCard[];
  nextCursor: string | null;
}>) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-10 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-600">
              CampusHub
            </p>
            <p className="mt-2 text-sm text-slate-600">{tenantDisplayName}</p>
          </div>
          <p className="text-sm font-medium text-slate-600">Student Home</p>
        </header>

        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-600">
            Your campus
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
            Campus Home
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-700">
            The latest notices and news that your campus has published for you.
          </p>
        </div>

        <div className="mt-10">
          <PublicationFeed items={items} nextCursor={nextCursor} />
        </div>
      </div>
    </main>
  );
}
