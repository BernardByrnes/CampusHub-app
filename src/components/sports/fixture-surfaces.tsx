import type { FixtureListItem } from "@/server/repositories/fixture-repository";

function stateLabel(state: FixtureListItem["fixture"]["state"]): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export function StudentFixturesPage({
  items,
  selectedSport,
  selectedCompetition,
  selectedTeam,
}: Readonly<{
  items: readonly FixtureListItem[];
  selectedSport?: string;
  selectedCompetition?: string;
  selectedTeam?: string;
}>) {
  const sports = [...new Set(items.map((item) => item.sportName))].sort();
  const competitions = [...new Set(items.map((item) => item.competitionName))].sort();
  const teams = [...new Set(items.flatMap((item) => [item.homeTeamName, item.awayTeamName]))].sort();
  return (
    <main aria-labelledby="fixtures-title" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">CampusHub · Sports</p>
        <h1 id="fixtures-title" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Fixtures</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-700">Browse upcoming and recent fixtures for your Campus. Match results and reminder notifications are not part of this release.</p>
        <form method="get" className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-3">
          <label className="text-sm font-medium">Sport<select name="sport" defaultValue={selectedSport ?? ""} className="mt-2 block w-full rounded-lg border border-slate-300 p-2"><option value="">All sports</option>{sports.map((sport) => <option key={sport} value={sport}>{sport}</option>)}</select></label>
          <label className="text-sm font-medium">Competition<select name="competition" defaultValue={selectedCompetition ?? ""} className="mt-2 block w-full rounded-lg border border-slate-300 p-2"><option value="">All competitions</option>{competitions.map((competition) => <option key={competition} value={competition}>{competition}</option>)}</select></label>
          <label className="text-sm font-medium">Team<select name="team" defaultValue={selectedTeam ?? ""} className="mt-2 block w-full rounded-lg border border-slate-300 p-2"><option value="">All teams</option>{teams.map((team) => <option key={team} value={team}>{team}</option>)}</select></label>
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:col-span-3 sm:justify-self-start">Apply filters</button>
        </form>
        <section aria-label="Fixture list" className="mt-6 grid gap-4">
          {items.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-700">No fixtures match these filters.</p> : items.map((item) => <article key={item.fixture.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-medium text-slate-600">{item.sportName} · {item.competitionName} · {item.campusLabel}</p><span className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold">State: {stateLabel(item.fixture.state)}</span></div><h2 className="mt-3 text-xl font-semibold">{item.homeTeamName} <span aria-hidden="true" className="text-slate-500">vs</span> {item.awayTeamName}</h2><p className="mt-2 text-sm text-slate-700"><time dateTime={item.fixture.startsAt.toISOString()}>{item.fixture.startsAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</time> · {item.fixture.venue}</p>{item.fixture.reason !== null ? <p className="mt-2 text-sm text-slate-700">Note: {item.fixture.reason}</p> : null}</article>)}
        </section>
      </div>
    </main>
  );
}

export function PublisherFixturesManagementPage() {
  return (
    <main aria-labelledby="publisher-fixtures-title" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">CampusHub · Publisher</p>
        <h1 id="publisher-fixtures-title" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Fixture management</h1>
        <p className="mt-4 text-base leading-7 text-slate-700">Fixture controls will be available when this request has a server-produced trusted Publisher context.</p>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">This page does not accept identity, Tenant, capability, or Fixture values from the browser. No management action is available without the trusted context seam.</p>
      </div>
    </main>
  );
}
