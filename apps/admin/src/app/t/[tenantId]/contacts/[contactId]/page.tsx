"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { useTimeAgo } from "@/components/app/time";
import { useMe } from "@/components/app/useMe";
import {
  ApiError,
  api,
  type ContactChannel,
  type ContactDetail,
  type ContactTimelineItem,
  type ContactUnavailable,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { formatPhone } from "@/lib/phone";

const CHANNELS: ContactChannel[] = ["sms", "email", "call", "note"];
const ICONS: Record<ContactChannel, string> = { sms: "💬", email: "✉️", call: "📞", note: "📝" };
/** The API's limits (@traiblazer/shared). */
const MAX: Record<ContactChannel, number> = { sms: 640, email: 5000, call: 2000, note: 2000 };
const SUBJECT_MAX = 150;
/** How often an open contact looks for an answer or a delivery report. */
const REFRESH_MS = 20_000;
const UNAVAILABLE: ContactUnavailable[] = ["no_phone", "no_email", "no_number", "opted_out", "capped"];

/**
 * One contact in the owner app: how to reach them, everything that happened with them (their
 * requests, their texts with the assistant, what the team sent), and a place to write back: a text
 * from the assistant's number, an email, a record of a call, or a note.
 */
export default function ContactPage() {
  const { t, language } = useI18n();
  const router = useRouter();
  const { tenantId, contactId } = useParams<{ tenantId: string; contactId: string }>();
  const { me } = useMe();
  const [detail, setDetail] = useState<ContactDetail | null | "missing">(null);
  const [channel, setChannel] = useState<ContactChannel | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeAgo = useTimeAgo();
  const base = `/v1/tenants/${tenantId}/contacts/${contactId}`;

  const load = useCallback(async () => {
    try {
      setDetail(await api<ContactDetail>(base));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setDetail("missing");
      else setError(t("common.error"));
    }
  }, [base, t]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const back = { href: `/t/${tenantId}/contacts`, label: t("contact.back") };
  if (detail === null || detail === "missing") {
    return (
      <AppShell title={t("contacts.title")} tab="contacts" tenantId={tenantId} back={back}>
        <p className={error ? "error" : "muted"}>
          {detail === "missing" ? t("contact.notFound") : (error ?? t("common.loading"))}
        </p>
      </AppShell>
    );
  }

  const { contact, reach, timeline } = detail;
  const membership = me?.tenants.find((item) => item.id === tenantId);
  // Support staff reach a business without being a member of it: notes only.
  const support = Boolean(me && !membership && me.user.platformRole);
  const canEdit = support || ["owner", "admin", "editor"].includes(membership?.role ?? "");
  const name = contact.name ?? (contact.phone ? formatPhone(contact.phone) : (contact.email ?? ""));
  const fmt = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });

  /** Why this channel can't be used for this contact, or null when it can. */
  const blocked = (id: ContactChannel): string | null => {
    if (support && (id === "sms" || id === "email")) return t("contact.unavailable.support");
    if (id === "sms" && !reach.sms.ok) return t(`contact.unavailable.${reach.sms.reason}`);
    if (id === "email" && !reach.email.ok) return t(`contact.unavailable.${reach.email.reason}`);
    if (id === "call" && !contact.phone) return t("contact.unavailable.no_phone");
    return null;
  };
  // Opens on the first way they can be written to; a note always works.
  const active = channel ?? CHANNELS.find((id) => id !== "call" && !blocked(id)) ?? "note";
  const reason = blocked(active);
  const text = body.trim();
  const ready =
    !reason && (active === "call" || text.length > 0) && (active !== "email" || subject.trim().length > 0);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/messages`, {
        method: "POST",
        body: { channel: active, body: text, ...(active === "email" ? { subject: subject.trim() } : {}) },
      });
      setBody("");
      setSubject("");
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code.replace(/^contact_/, "") : "";
      setError(
        UNAVAILABLE.includes(code as ContactUnavailable)
          ? t(`contact.unavailable.${code as ContactUnavailable}`)
          : t("common.error"),
      );
      // Why it was refused may have changed what can be sent (they just opted out).
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("contact.removeConfirm", { name }))) return;
    setBusy(true);
    try {
      await api(base, { method: "DELETE" });
      router.replace(`/t/${tenantId}/contacts`);
    } catch {
      setError(t("common.error"));
      setBusy(false);
    }
  }

  const hint =
    active === "sms" && reach.sms.ok
      ? t("contact.hint.sms", { number: formatPhone(reach.sms.from) })
      : active === "email"
        ? t("contact.hint.email", { email: me?.user.email ?? "" })
        : active === "call"
          ? t("contact.hint.call")
          : active === "note"
            ? t("contact.hint.note")
            : null;

  return (
    <AppShell title={name} tab="contacts" tenantId={tenantId} back={back}>
      <section className="card flex flex-col gap-3 p-5">
        <h2 className={contact.name ? "text-lg font-semibold" : "muted text-lg font-semibold"} dir="auto">
          {contact.name ?? t("contacts.unnamed")}
        </h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {contact.phone && (
            <a dir="ltr" className="tabular-nums underline underline-offset-4" href={`tel:${contact.phone}`}>
              {formatPhone(contact.phone)}
            </a>
          )}
          {contact.email && (
            <span dir="ltr" className="min-w-0 break-all">
              {contact.email}
            </span>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="history-title">
        <h2 id="history-title" className="font-semibold">
          {t("contact.history")}
        </h2>
        {timeline.length === 0 ? (
          <p className="muted text-sm">{t("contact.historyEmpty")}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {timeline.map((item) => (
              <TimelineEntry
                key={`${item.type}-${item.id}`}
                item={item}
                tenantId={tenantId}
                when={
                  <time className="muted" dateTime={item.at} title={fmt.format(new Date(item.at))}>
                    {timeAgo(item.at)}
                  </time>
                }
              />
            ))}
          </ol>
        )}
      </section>

      {canEdit ? (
        <form className="card flex flex-col gap-3 p-5" onSubmit={send} aria-labelledby="write-title">
          <h2 id="write-title" className="font-semibold">
            {t("contact.write", { name })}
          </h2>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((id) => (
              <button
                key={id}
                type="button"
                className="chip min-h-10"
                data-selected={active === id}
                aria-pressed={active === id}
                onClick={() => {
                  setChannel(id);
                  setError(null);
                }}
              >
                <span aria-hidden="true">{ICONS[id]} </span>
                {t(`contact.channel.${id}`)}
              </button>
            ))}
          </div>

          {reason ? (
            <p className="muted text-sm" role="status">
              {reason}
            </p>
          ) : (
            <>
              {active === "call" && contact.phone && (
                <a className="btn min-h-12" href={`tel:${contact.phone}`}>
                  📞 {t("contact.callNow", { number: formatPhone(contact.phone) })}
                </a>
              )}
              {active === "email" && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="muted">{t("contact.subject")}</span>
                  <input
                    className="input min-h-11"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={SUBJECT_MAX}
                    dir="auto"
                  />
                </label>
              )}
              <label htmlFor="contact-body" className="sr-only">
                {t("contact.writeLabel")}
              </label>
              <textarea
                id="contact-body"
                className={active === "email" ? "input min-h-40" : "input min-h-24"}
                maxLength={MAX[active]}
                placeholder={t(`contact.placeholder.${active}`)}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                dir="auto"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" className="btn min-h-12" disabled={busy || !ready}>
                  {t(`contact.send.${active}`)}
                </button>
                {active === "sms" && (
                  <span className="muted text-xs tabular-nums">
                    {t("contact.chars", { count: body.length, max: MAX.sms })}
                  </span>
                )}
              </div>
              {hint && <p className="muted text-xs">{hint}</p>}
            </>
          )}
        </form>
      ) : (
        membership && <p className="muted text-sm">{t("contact.viewOnly")}</p>
      )}

      {error && (
        <p className="error text-sm" role="alert">
          {error}
        </p>
      )}

      {canEdit && !support && (
        <button
          type="button"
          className="muted self-center text-sm underline underline-offset-4"
          disabled={busy}
          onClick={() => void remove()}
        >
          {t("contact.remove")}
        </button>
      )}
    </AppShell>
  );
}

/** One entry of a contact's history: theirs on the left, the business's on the right. */
function TimelineEntry({
  item,
  tenantId,
  when,
}: {
  item: ContactTimelineItem;
  tenantId: string;
  when: ReactNode;
}) {
  const { t } = useI18n();

  if (item.type === "request") {
    const urgent = item.urgent && item.status !== "done";
    return (
      <li>
        <Link
          href={`/t/${tenantId}/inbox/${item.botId}/${item.id}`}
          className="card flex flex-col gap-2 p-4 hover:bg-[var(--surface-3)]"
          style={urgent ? { boxShadow: "inset 4px 0 0 var(--danger)" } : undefined}
        >
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold">{t("contact.request")}</span>
            {urgent && (
              <span className="badge" style={{ background: "#b42318", color: "#ffffff" }}>
                {t("requests.urgent")}
              </span>
            )}
            <span className="badge">{t(`requests.kind.${item.kind}`)}</span>
            <span className={item.status === "new" ? "badge badge-accent" : "badge"}>
              {t(`requests.status.${item.status}`)}
            </span>
            <span className="ms-auto">{when}</span>
          </span>
          <span className="line-clamp-3 text-sm" dir="auto">
            {item.message}
          </span>
        </Link>
      </li>
    );
  }

  const theirs = item.type === "text" && item.from === "contact";
  const note = item.type === "team" && (item.channel === "note" || item.channel === "call");
  const failed = item.type === "team" && item.status === "failed";
  const who =
    item.type === "text"
      ? `${ICONS.sms} ${t(`contact.from.${item.from}`)}`
      : `${ICONS[item.channel]} ${item.authorName ?? t("request.someone")}`;
  return (
    <li className={`flex max-w-[88%] flex-col gap-1 ${theirs ? "self-start" : "self-end"}`}>
      <span className="flex flex-wrap items-baseline gap-2 text-xs">
        <span className="font-semibold" dir="auto">
          {who}
        </span>
        {item.type === "team" && <span className="muted">{t(`contact.channel.${item.channel}`)}</span>}
        {when}
      </span>
      <div
        className="panel flex flex-col gap-1 p-3"
        style={
          note
            ? { borderStyle: "dashed" }
            : theirs
              ? undefined
              : { background: "color-mix(in srgb, var(--accent) 10%, var(--surface))" }
        }
      >
        {item.type === "team" && item.subject && (
          <p className="text-sm font-semibold" dir="auto">
            {item.subject}
          </p>
        )}
        <p className="text-sm break-words whitespace-pre-wrap" dir="auto">
          {item.body || (item.type === "team" && item.channel === "call" ? t("contact.called") : "")}
        </p>
      </div>
      {item.type === "team" && !note && (
        <span className={failed ? "error text-xs" : "muted text-xs"} role={failed ? "alert" : undefined}>
          {t(`contact.status.${item.status}`)}
          {failed &&
            ` · ${
              item.error === "not_configured"
                ? t("contact.error.not_configured")
                : item.error === "opted_out" || item.error === "21610"
                  ? t("contact.error.opted_out")
                  : t("contact.error.other")
            }`}
        </span>
      )}
    </li>
  );
}
