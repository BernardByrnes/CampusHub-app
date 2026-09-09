export default function StudentHomeLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading Campus Home"
      className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-10"
    >
      <div className="mx-auto w-full max-w-3xl animate-pulse">
        <div className="h-6 w-32 rounded bg-slate-200" />
        <div className="mt-10 h-12 w-64 rounded bg-slate-200" />
        <div className="mt-4 h-5 w-full max-w-xl rounded bg-slate-200" />
        <div className="mt-10 grid gap-4">
          <div className="h-44 rounded-2xl border border-slate-200 bg-white" />
          <div className="h-44 rounded-2xl border border-slate-200 bg-white" />
        </div>
      </div>
    </main>
  );
}
