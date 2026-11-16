"use client";

import { enOrFr } from "@traiblazer/i18n";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { useTimeAgo } from "@/components/app/time";
import { useMe } from "@/components/app/useMe";
import {
  ApiError,
  api,
  type BotDetail,
  type InboxLead,
  type Lead,
  type LeadComment,
  type LeadStatus,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Detail = { lead: InboxLead & { booking: Lead["booking"] }; comments: LeadComment[] };

const digits = (phone: string) => phone.replace(/[^\d+]/g, "");

/**
 * One request in the owner app (PLAN §20.2): who, what, how to reach them with one tap, its
 * status, and the team's notes. Opened from the inbox or straight from a notification.
 */
export default function RequestPage() {
  const { t, language } = useI18n();
  const { tenantId, botId, leadId } = useParams<{ tenantId: string; botId: string; leadId: string }>();
  const { me } = useMe();
  const [detail, setDetail] = useState<Detail | null | "missing">(null);
  const [fields, setFields] = useState<BotDetail["defaults"]["leadFields"]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeAgo = useTimeAgo();
  const base = `/v1/tenants/${tenantId}/bots/${botId}`;

  const load = useCallback(async () => {
    try {
      setDetail(await api<Detail>(`${base}/leads/${leadId}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setDetail("missing");
      else setError(t("common.error"));
    }
  }, [base, leadId, t]);

  useEffect(() => {
    void load();
    // The industry's request fields (vehicle, tire size…), for their labels.
    api<BotDetail>(base)
      .then((bot) => setFields(bot.defaults.leadFields))
      .catch(() => setFields([]));
  }, [load, base]);

  const role = me?.tenants.find((item) => item.id === tenantId)?.role;
  const canEdit = role === "owner" || role === "admin" || role === "editor";

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const setStatus = (status: LeadStatus) =>
    run(() => api(`${base}/leads/${leadId}`, { method: "PATCH", body: { status } }));

  function addNote(event: FormEvent) {
    event.preventDefault();
    if (!note.trim()) return;
    void run(async () => {
      await api(`${base}/leads/${leadId}/comments`, { method: "POST", body: { body: note } });
      setNote("");
    });
  }

  const back = { href: `/t/${tenantId}/inbox`, label: t("request.back") };
  if (detail === null || detail === "missing") {
    return (
      <AppShell title={t("inbox.title")} tab="inbox" tenantId={tenantId} back={back}>
        <p className={error ? "error" : "muted"}>
          {detail === "missing" ? t("request.notFound") : (error ?? t("common.loading"))}
        </p>
      </AppShell>
    );
  }

  const { lead, comments } = detail;
  const urgent = lead.urgent && lead.status !== "done";
  const fmt = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  const fieldLabel = (key: string) => fields.find((f) => f.key === key)?.label[enOrFr(language)] ?? key;
  const bookedTime = (booking: NonNullable<Lead["booking"]>) =>
    new Intl.DateTimeFormat(`${language}-CA`, {
      timeZone: booking.timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).formatRange(new Date(booking.startsAt), new Date(booking.endsAt));

  return (
    <AppShell title={lead.name} tab="inbox" tenantId={tenantId} back={back}>
      <section
        className="card flex flex-col gap-3 p-5"
        style={urgent ? { boxShadow: "inset 4px 0 0 var(--danger)" } : undefined}
      >
        <div className="flex flex-wrap items-center gap-2">
          {urgent && (
            <span className="badge" style={{ background: "#b42318", color: "#ffffff" }}>
              {t("requests.urgent")}
            </span>
          )}
          <span className="badge">{t(`requests.kind.${lead.kind}`)}</span>
          <span className={lead.status === "new" ? "badge badge-accent" : "badge"}>
            {t(`requests.status.${lead.status}`)}
          </span>
          {lead.itemName && (
            <span className="badge" dir="auto">
              {t("requests.item", { item: lead.itemName })}
            </span>
          )}
        </div>
        <p className="muted text-xs">
          <time dateTime={lead.createdAt} title={fmt.format(new Date(lead.createdAt))}>
            {t("request.received", { time: timeAgo(lead.createdAt) })}
          </time>
          {" · "}
          <span dir="auto">{t("request.via", { assistant: lead.businessName ?? lead.botName })}</span>
        </p>

        {/* One tap to reach the customer: the reason the owner opened the app. */}
        {(lead.phone || lead.email) && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
            {lead.phone && (
              <a className="btn min-h-12" href={`tel:${digits(lead.phone)}`}>
                📞 {t("request.call")}
              </a>
            )}
            {lead.phone && (
              <a className="btn btn-ghost min-h-12" href={`sms:${digits(lead.phone)}`}>
                💬 {t("request.text")}
              </a>
            )}
            {lead.email && (
              <a className="btn btn-ghost min-h-12" href={`mailto:${lead.email}`}>
                ✉️ {t("request.email")}
              </a>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {lead.phone && (
            <span dir="ltr" className="tabular-nums">
              {lead.phone}
            </span>
          )}
          {lead.email && <span dir="ltr">{lead.email}</span>}
          {lead.bestTime && !lead.booking && (
            <span className="muted" dir="auto">
              {t("requests.bestTime", { time: lead.bestTime })}
            </span>
          )}
        </div>

        {lead.booking && (
          <p className="text-sm font-medium">
            📅 {t("requests.booked", { name: lead.booking.providerName, time: bookedTime(lead.booking) })}
          </p>
        )}

        <p className="text-base whitespace-pre-wrap" dir="auto">
          {lead.message}
        </p>

        {Object.keys(lead.details ?? {}).length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" aria-label={t("request.details")}>
            {Object.entries(lead.details).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="muted">{fieldLabel(key)}</dt>
                <dd dir="auto">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {lead.conversationId && lead.attachmentIds.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label={t("requests.photos")}>
            {lead.attachmentIds.map((id) => {
              const src = `/api${base}/conversations/${lead.conversationId}/attachments/${id}`;
              return (
                <li key={id}>
                  <a href={src} target="_blank" rel="noopener noreferrer">
                    {/* biome-ignore lint/performance/noImgElement: private visitor image served by the API */}
                    <img
                      src={src}
                      alt={t("requests.photo")}
                      className="h-24 w-24 rounded-xl border border-[var(--border)] object-cover"
                    />
                  </a>
                </li>
              );
            })}
          </ul>
        )}

        {canEdit ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {lead.status === "new" && (
              <button
                type="button"
                className="btn btn-ghost min-h-12"
                disabled={busy}
                onClick={() => setStatus("in_progress")}
              >
                {t("requests.start")}
              </button>
            )}
            {lead.status !== "done" ? (
              <button
                type="button"
                className="btn min-h-12"
                disabled={busy}
                onClick={() => setStatus("done")}
              >
                {t("requests.finish")}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost min-h-12"
                disabled={busy}
                onClick={() => setStatus("new")}
              >
                {t("requests.reopen")}
              </button>
            )}
          </div>
        ) : (
          role && <p className="muted text-sm">{t("request.viewOnly")}</p>
        )}
      </section>

      <section className="card flex flex-col gap-3 p-5" aria-labelledby="notes-title">
        <div className="flex flex-col gap-1">
          <h2 id="notes-title" className="font-semibold">
            {t("request.notes")}
          </h2>
          <p className="muted text-xs">{t("request.notesIntro")}</p>
        </div>
        {comments.length === 0 ? (
          <p className="muted text-sm">{t("request.noNotes")}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {comments.map((comment) => (
              <li key={comment.id} className="panel flex flex-col gap-1 p-3">
                <span className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="font-semibold" dir="auto">
                    {comment.authorName ?? t("request.someone")}
                  </span>
                  <time
                    className="muted"
                    dateTime={comment.createdAt}
                    title={fmt.format(new Date(comment.createdAt))}
                  >
                    {timeAgo(comment.createdAt)}
                  </time>
                </span>
                <p className="text-sm whitespace-pre-wrap" dir="auto">
                  {comment.body}
                </p>
              </li>
            ))}
          </ol>
        )}
        {canEdit && (
          <form className="flex flex-col gap-2" onSubmit={addNote}>
            <label htmlFor="new-note" className="sr-only">
              {t("request.noteLabel")}
            </label>
            <textarea
              id="new-note"
              className="input min-h-24"
              maxLength={2000}
              placeholder={t("request.notePlaceholder")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              dir="auto"
            />
            <div>
              <button type="submit" className="btn min-h-12" disabled={busy || !note.trim()}>
                {t("request.addNote")}
              </button>
            </div>
          </form>
        )}
      </section>

      {error && (
        <p className="error text-sm" role="alert">
          {error}
        </p>
      )}

      {lead.contactId && (
        <Link href={`/t/${tenantId}/contacts/${lead.contactId}`} className="btn btn-ghost min-h-12">
          {t("request.openContact", { name: lead.name })}
        </Link>
      )}

      <Link
        href={`/t/${tenantId}/bots/${botId}?tab=requests`}
        className="muted self-center text-sm underline underline-offset-4"
      >
        {t("request.openPortal")}
      </Link>
    </AppShell>
  );
}
