import { formatLegalDate, type Lang, LEGAL_UI, type LegalDoc, type SiteConfig } from "@traiblazer/marketing";
import { SiteShell } from "@/components/site/SiteShell";

/** Lays out one legal document (Cookies Policy, AI usage disclaimer) inside the marketing shell. */
export function LegalPage({
  site,
  lang,
  doc,
  alternates,
}: {
  site: SiteConfig;
  lang: Lang;
  doc: LegalDoc;
  alternates: Record<Lang, string>;
}) {
  return (
    <SiteShell site={site} lang={lang} alternates={alternates}>
      <article className="mx-auto flex max-w-3xl flex-col gap-10 px-4 pt-10 pb-16 sm:pt-16">
        <header className="flex flex-col gap-3">
          <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
            {doc.title}
          </h1>
          <p className="muted text-sm">
            {LEGAL_UI[lang].updated}
            {lang === "fr" ? "\u00a0: " : ": "}
            {formatLegalDate(lang)}
          </p>
          <p className="text-lg">{doc.lead}</p>
        </header>

        {doc.sections.map((section) => (
          <section key={section.heading} className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold tracking-tight">{section.heading}</h2>
            {section.paragraphs?.map((text) => (
              <p key={text} className="muted leading-relaxed">
                {text}
              </p>
            ))}
            {section.items && (
              <ul className="muted flex list-disc flex-col gap-2 pl-5 leading-relaxed">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        {doc.stored && (
          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold tracking-tight">{doc.stored.heading}</h2>
            <div className="card overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {doc.stored.columns.map((column) => (
                      <th key={column} scope="col" className="px-4 py-3 font-semibold whitespace-nowrap">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {doc.stored.rows.map((row) => (
                    <tr key={row.name} className="border-b border-[var(--border)] last:border-0 align-top">
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{row.name}</td>
                      <td className="muted px-4 py-3">{row.type}</td>
                      <td className="muted px-4 py-3">{row.purpose}</td>
                      <td className="muted px-4 py-3">{row.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </article>
    </SiteShell>
  );
}
