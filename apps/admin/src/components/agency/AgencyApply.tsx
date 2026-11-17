"use client";

import { type FormEvent, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** The partner application: the applicant becomes the agency's owner once operators approve it. */
export function AgencyApply({ onApplied }: { onApplied: () => Promise<void> }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      await api("/v1/agencies", {
        method: "POST",
        body: {
          name: text("name"),
          country: text("country"),
          currency: text("currency") || "CAD",
          ...(text("website") ? { website: text("website") } : {}),
          ...(text("note") ? { note: text("note") } : {}),
        },
      });
      await onApplied();
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 500 ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card flex flex-col gap-5 p-5 sm:p-7" aria-labelledby="agency-apply">
      <div className="flex flex-col gap-2">
        <h1 id="agency-apply" className="text-2xl font-semibold">
          {t("agency.apply.title")}
        </h1>
        <p className="muted">{t("agency.apply.intro")}</p>
      </div>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          {t("agency.apply.name")}
          <input className="input" name="name" required minLength={2} maxLength={120} />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          {t("agency.apply.website")}
          <input className="input" name="website" type="url" placeholder="https://" maxLength={500} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("agency.apply.country")}
          <input
            className="input uppercase"
            name="country"
            required
            pattern="[A-Za-z]{2}"
            maxLength={2}
            defaultValue="CA"
            autoComplete="country"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("agency.apply.currency")}
          <input
            className="input uppercase"
            name="currency"
            required
            pattern="[A-Za-z]{3}"
            maxLength={3}
            defaultValue="CAD"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          {t("agency.apply.note")}
          <textarea className="input min-h-28" name="note" maxLength={2000} />
        </label>
        <div className="sm:col-span-2">
          <button className="btn" type="submit" disabled={busy} aria-busy={busy}>
            {t("agency.apply.submit")}
          </button>
        </div>
        {error && (
          <p className="error text-sm sm:col-span-2" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
