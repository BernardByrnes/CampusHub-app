export function SportsManagementPage() {
  return (
    <main
      aria-labelledby="sports-management-title"
      className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6"
    >
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
          CampusHub · Publisher
        </p>
        <h1
          id="sports-management-title"
          className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Sports management
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-700">
          Sport, Competition, and Team management will be available when this
          request has a server-produced trusted Publisher context.
        </p>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          This page does not accept identity, Tenant, or capability values from
          the browser. No management action is available without the trusted
          context seam.
        </p>
      </div>
    </main>
  );
}
