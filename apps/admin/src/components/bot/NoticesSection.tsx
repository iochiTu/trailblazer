"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api, type CatalogItem, type Notice } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** A `datetime-local` value (the owner's own time) as an ISO time, or null when empty. */
const toIso = (value: FormDataEntryValue | null) =>
  typeof value === "string" && value ? new Date(value).toISOString() : null;

/** Time-limited announcements at the top of the business page (Business page tab). */
export function NoticesSection({ base, onSaved }: { base: string; onSaved: () => void }) {
  const { t, language } = useI18n();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [limit, setLimit] = useState(0);
  /** Services and products an offer can be about. */
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [offer, setOffer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api<{ notices: Notice[]; limit: number }>(`${base}/notices`);
    setNotices(data.notices);
    setLimit(data.limit);
    setItems((await api<{ items: CatalogItem[] }>(`${base}/catalog`)).items);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  function status(notice: Notice): string {
    const now = Date.now();
    if (notice.endsAt && new Date(notice.endsAt).getTime() <= now) return t("notices.ended");
    if (notice.startsAt && new Date(notice.startsAt).getTime() > now) {
      return t("notices.scheduled", { date: formatDate(notice.startsAt) });
    }
    return notice.endsAt ? `${t("notices.running")} · ${formatDate(notice.endsAt)}` : t("notices.running");
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      onSaved();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues[0]?.message ?? err.message) : t("common.error"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = {
      text: data.get("text"),
      startsAt: toIso(data.get("startsAt")),
      endsAt: toIso(data.get("endsAt")),
      ...(offer
        ? { kind: "offer", title: data.get("title"), itemId: String(data.get("itemId") ?? "") || null }
        : { kind: "notice" }),
    };
    if (await run(() => api(`${base}/notices`, { method: "POST", body }))) {
      form.reset();
      setOffer(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-lg font-semibold">{t("notices.title")}</h3>
        <p className="muted text-sm">{t("notices.hint")}</p>
      </div>
      {notices === null ? (
        <p className="muted text-sm">{t("common.loading")}</p>
      ) : notices.length === 0 ? (
        <p className="muted text-sm">{t("notices.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notices.map((notice) => (
            <li key={notice.id} className="panel flex items-start justify-between gap-3 p-3">
              <div className="min-w-0" dir="auto">
                {notice.kind === "offer" && (
                  <p className="text-sm">
                    <span className="badge badge-accent me-2">{t("notices.offer.badge")}</span>
                    <span className="font-semibold">{notice.title}</span>
                    {notice.catalogItemId && items.some((i) => i.id === notice.catalogItemId) && (
                      <span className="muted">
                        {" · "}
                        {items.find((i) => i.id === notice.catalogItemId)?.name}
                      </span>
                    )}
                  </p>
                )}
                <p className="font-medium">{notice.text}</p>
                <p className="muted text-xs">{status(notice)}</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost py-1"
                disabled={busy}
                onClick={() => void run(() => api(`${base}/notices/${notice.id}`, { method: "DELETE" }))}
              >
                {t("common.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {notices !== null && notices.length >= limit ? (
        <p className="muted text-sm">{t("notices.limit")}</p>
      ) : (
        <form
          className="panel grid gap-3 p-4 sm:p-5 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end"
          onSubmit={add}
        >
          <div className="flex flex-col gap-1 md:col-span-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={offer} onChange={(e) => setOffer(e.target.checked)} />
              <span className="font-medium">{t("notices.offer.toggle")}</span>
            </label>
            <p className="muted text-sm">{t("notices.offer.hint")}</p>
          </div>
          {offer && (
            <>
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                {t("notices.offer.title")}
                <input className="input" name="title" required maxLength={80} dir="auto" />
              </label>
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                {t("notices.offer.item")}
                <select className="input" name="itemId" defaultValue="">
                  <option value="">{t("notices.offer.noItem")}</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="flex flex-col gap-1 text-sm">
            {offer ? t("notices.offer.text") : t("notices.text")}
            <input className="input" name="text" required maxLength={300} dir="auto" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("notices.starts")}
            <input className="input" name="startsAt" type="datetime-local" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("notices.ends")}
            <input className="input" name="endsAt" type="datetime-local" />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            {offer ? t("notices.offer.add") : t("notices.add")}
          </button>
        </form>
      )}
      {error && (
        <p className="error text-sm" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
