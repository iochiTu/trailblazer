"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { CONSENT_OPEN_EVENT, type Consent, saveConsent } from "@/lib/consent";
import { useI18n } from "@/lib/i18n";

/**
 * Floating cookie card, bottom corner of every page. It doesn't block the page; it stays until the
 * visitor accepts or rejects. `initial` comes from the server, so people who already chose never
 * see it flash.
 */
export function CookieConsent({ initial }: { initial: Consent | null }) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(initial === null);
  const titleId = useId();

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(CONSENT_OPEN_EVENT, show);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, show);
  }, []);

  if (!open) return null;

  const choose = (choice: Consent) => {
    saveConsent(choice);
    setOpen(false);
  };
  const policy = language.startsWith("fr") ? "/fr/cookies" : "/en/cookies";

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="card fixed inset-x-4 !border-[var(--border)] !bg-[var(--surface-2)] bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex flex-col gap-4 p-5 shadow-[var(--shadow-2)] sm:right-auto sm:left-6 sm:max-w-md"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id={titleId} className="font-semibold">
          {t("consent.title")}
        </h2>
        <p className="muted text-sm leading-relaxed">
          {t("consent.body")}{" "}
          <Link href={policy} className="underline underline-offset-2 hover:text-[var(--text)]">
            {t("consent.policy")}
          </Link>
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost flex-1 !bg-[var(--surface-3)] sm:flex-none"
          onClick={() => choose("rejected")}
        >
          {t("consent.reject")}
        </button>
        <button type="button" className="btn flex-1 sm:flex-none" onClick={() => choose("accepted")}>
          {t("consent.accept")}
        </button>
      </div>
    </section>
  );
}

/** Footer link that reopens the card so visitors can change their mind. */
export function CookieSettingsLink({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="cursor-pointer text-left"
      onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}
    >
      {label}
    </button>
  );
}
