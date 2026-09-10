import {
  transparencyContent,
  type TransparencyContent,
  type TransparencySection,
} from "@/components/transparency/transparency-content";

function DisclosureSection({
  section,
}: Readonly<{ section: TransparencySection }>) {
  return (
    <section
      id={section.id}
      aria-labelledby={`${section.id}-title`}
      className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
        {section.eyebrow}
      </p>
      <h2
        id={`${section.id}-title`}
        className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl"
      >
        {section.title}
      </h2>
      <div className="mt-5 space-y-4 text-base leading-8 text-slate-700">
        {section.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      {section.bullets !== undefined ? (
        <ul className="mt-5 list-disc space-y-3 pl-5 text-base leading-7 text-slate-700">
          {section.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      ) : null}
      {section.note !== undefined ? (
        <aside
          aria-label={section.note.label}
          className={`mt-6 border-l-4 p-4 text-sm leading-6 ${
            section.note.tone === "caution"
              ? "border-amber-500 bg-amber-50 text-amber-950"
              : "border-slate-400 bg-slate-50 text-slate-800"
          }`}
        >
          <p className="font-semibold">{section.note.label}</p>
          <p className="mt-1">{section.note.text}</p>
        </aside>
      ) : null}
    </section>
  );
}

function StatusList({
  items,
}: Readonly<{
  items: TransparencyContent["currentBuild"]["enabled"];
}>) {
  return (
    <ul className="mt-5 space-y-4">
      {items.map((item) => (
        <li
          key={item.title}
          className="rounded-xl border border-slate-200 bg-slate-50 p-4"
        >
          <h3 className="font-semibold text-slate-950">{item.title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-700">{item.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export function TransparencyPage({
  content = transparencyContent,
}: Readonly<{ content?: TransparencyContent }>) {
  return (
    <main
      aria-labelledby="transparency-title"
      className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 sm:py-10"
    >
      <div className="mx-auto w-full max-w-4xl">
        <header className="border-b border-slate-200 pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-600">
            CampusHub · {content.eyebrow}
          </p>
          <h1
            id="transparency-title"
            className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl"
          >
            {content.pageTitle}
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-700">
            {content.introduction}
          </p>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">
            This is student-readable product information, not a legal notice.
          </p>
        </header>

        <nav
          aria-label="On this page"
          className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
        >
          <h2 className="text-base font-semibold text-slate-950">On this page</h2>
          <ul className="mt-3 grid gap-x-6 gap-y-2 text-sm leading-6 sm:grid-cols-2">
            {content.sections.map((section) => (
              <li key={section.id}>
                <a
                  className="rounded-sm text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-950 hover:decoration-slate-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-950"
                  href={`#${section.id}`}
                >
                  {section.title}
                </a>
              </li>
            ))}
            <li>
              <a
                className="rounded-sm text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-950 hover:decoration-slate-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-950"
                href={`#${content.currentBuild.id}`}
              >
                {content.currentBuild.title}
              </a>
            </li>
            <li>
              <a
                className="rounded-sm text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-950 hover:decoration-slate-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-950"
                href={`#${content.tenantSpecific.id}`}
              >
                {content.tenantSpecific.title}
              </a>
            </li>
          </ul>
        </nav>

        <div className="mt-8 space-y-5">
          {content.sections.map((section) => (
            <DisclosureSection key={section.id} section={section} />
          ))}

          <section
            id={content.currentBuild.id}
            aria-labelledby={`${content.currentBuild.id}-title`}
            className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
              {content.currentBuild.eyebrow}
            </p>
            <h2
              id={`${content.currentBuild.id}-title`}
              className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl"
            >
              {content.currentBuild.title}
            </h2>
            <p className="mt-5 max-w-3xl text-base leading-8 text-slate-700">
              {content.currentBuild.introduction}
            </p>
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                <h3 className="text-lg font-semibold text-emerald-950">
                  Implemented foundation
                </h3>
                <StatusList items={content.currentBuild.enabled} />
              </article>
              <article className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="text-lg font-semibold text-slate-950">
                  Not yet enabled
                </h3>
                <StatusList items={content.currentBuild.notEnabled} />
              </article>
            </div>
          </section>

          <section
            id={content.tenantSpecific.id}
            aria-labelledby={`${content.tenantSpecific.id}-title`}
            className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
              {content.tenantSpecific.eyebrow}
            </p>
            <h2
              id={`${content.tenantSpecific.id}-title`}
              className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl"
            >
              {content.tenantSpecific.title}
            </h2>
            <p className="mt-5 max-w-3xl text-base leading-8 text-slate-700">
              {content.tenantSpecific.text}
            </p>
          </section>
        </div>

        <footer className="border-t border-slate-200 py-8 text-sm leading-6 text-slate-600">
          <p>{content.closing}</p>
        </footer>
      </div>
    </main>
  );
}
