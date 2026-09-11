import type {
  StudentResultHistoryItem,
  StudentResultItem,
} from "@/application/sports/list-results";

function scoreLabel(homeScore: number, awayScore: number): string {
  return `${homeScore} – ${awayScore}`;
}

export function StudentResultsPage({
  items,
  selectedSport,
  selectedCompetition,
  selectedTeam,
}: Readonly<{
  items: readonly StudentResultItem[];
  selectedSport?: string;
  selectedCompetition?: string;
  selectedTeam?: string;
}>) {
  return (
    <main aria-labelledby="results-title" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">CampusHub · Sports</p>
        <h1 id="results-title" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Results</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-700">Published final scores for completed Fixtures. Drafts are never shown to students.</p>
        <form method="get" className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-3">
          <label className="text-sm font-medium">Sport<input name="sport" defaultValue={selectedSport ?? ""} className="mt-2 block w-full rounded-lg border border-slate-300 p-2" /></label>
          <label className="text-sm font-medium">Competition<input name="competition" defaultValue={selectedCompetition ?? ""} className="mt-2 block w-full rounded-lg border border-slate-300 p-2" /></label>
          <label className="text-sm font-medium">Team<input name="team" defaultValue={selectedTeam ?? ""} className="mt-2 block w-full rounded-lg border border-slate-300 p-2" /></label>
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:col-span-3 sm:justify-self-start">Apply filters</button>
        </form>
        <section aria-label="Published Result list" className="mt-6 grid gap-4">
          {items.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-700">No published Results match these filters.</p> : items.map((item) => (
            <article key={item.resultId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-slate-600">{item.sportName} · {item.competitionName} · {item.campusLabel}</p>
              <h2 className="mt-3 text-xl font-semibold">{item.homeTeamName} <span aria-hidden="true" className="text-slate-500">vs</span> {item.awayTeamName}</h2>
              <p className="mt-3 text-3xl font-semibold tracking-tight" aria-label="Final score">{scoreLabel(item.homeScore, item.awayScore)}</p>
              <p className="mt-2 text-sm text-slate-700">Final score · Revision {item.revisionNumber}{item.corrected ? " · Corrected" : ""}</p>
              <p className="mt-2 text-sm text-slate-600">{item.startsAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {item.venue}</p>
              <a
                href={`/sports/results/${item.resultId}/history`}
                className="mt-4 inline-block text-sm font-semibold text-slate-900 underline underline-offset-4"
              >
                View correction history
              </a>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

export function StudentResultHistoryPage({
  resultLabel,
  history,
}: Readonly<{
  resultLabel: string;
  history: readonly StudentResultHistoryItem[];
}>) {
  return (
    <main aria-labelledby="result-history-title" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">CampusHub · Sports</p>
        <h1 id="result-history-title" className="mt-3 text-3xl font-semibold tracking-tight">Correction history</h1>
        <p className="mt-3 text-base text-slate-700">{resultLabel}</p>
        <ol aria-label="Result revisions" className="mt-6 grid gap-4">
          {history.map((revision) => (
            <li key={revision.revisionNumber} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="font-semibold">Revision {revision.revisionNumber}: {scoreLabel(revision.homeScore, revision.awayScore)}</p>
              <time className="mt-2 block text-sm text-slate-600" dateTime={revision.createdAt.toISOString()}>{revision.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</time>
              {revision.correctionReason !== null ? <p className="mt-3 text-sm leading-6 text-slate-700">Reason: {revision.correctionReason}</p> : null}
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}

export function PublisherResultsManagementPage() {
  return (
    <main aria-labelledby="publisher-results-title" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">CampusHub · Publisher</p>
        <h1 id="publisher-results-title" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Result management</h1>
        <p className="mt-4 text-base leading-7 text-slate-700">Result controls will be available when a server-produced trusted Publisher context is available.</p>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">This page does not accept identity, Tenant, capability, Result, or score values from the browser. No management action is available without the trusted context seam.</p>
      </div>
    </main>
  );
}
