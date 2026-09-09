import Link from "next/link";

export function CampusHomeUnavailableState() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-600">
        Campus Home
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
        Campus updates are not available for this request.
      </h1>
      <p className="max-w-xl text-base leading-7 text-slate-700">
        A trusted campus context is required before updates can be shown.
      </p>
      <Link
        className="inline-flex min-h-11 w-fit items-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white underline-offset-4 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-950"
        href="/"
      >
        Try again
      </Link>
    </main>
  );
}

export function CampusHomeErrorState() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-600">
        Campus Home
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
        We couldn’t load your campus updates.
      </h1>
      <p className="max-w-xl text-base leading-7 text-slate-700">
        Please try again in a moment.
      </p>
      <Link
        className="inline-flex min-h-11 w-fit items-center rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-950 underline-offset-4 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-950"
        href="/"
      >
        Try again
      </Link>
    </main>
  );
}
