"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { useTimeAgo } from "@/components/app/time";
import { rememberTenant, useMe } from "@/components/app/useMe";
import { ApiError, api, type ContactSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { formatPhone } from "@/lib/phone";

/** How often an open list looks for new contacts. */
const REFRESH_MS = 30_000;
/** A pause in typing before the search runs. */
const SEARCH_DELAY_MS = 250;

/**
 * Contacts in the owner app: everyone who left a request with the business's assistants, texted or
 * called their number, last heard from first. Tapping one opens their history and a place to write
 * back by text or email.
 */
export default function ContactsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { tenantId } = useParams<{ tenantId: string }>();
  const { me, error: meError } = useMe();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ contacts: ContactSummary[]; total: number } | null>(null);
  const [error, setError] = useState(false);
  const timeAgo = useTimeAgo();

  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const load = useCallback(async () => {
    try {
      setData(await api(`/v1/tenants/${tenantId}/contacts${q ? `?q=${encodeURIComponent(q)}` : ""}`));
      setError(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) router.replace("/inbox");
      else setError(true);
    }
  }, [tenantId, q, router]);

  useEffect(() => {
    rememberTenant(tenantId);
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [tenantId, load]);

  const tenant = me?.tenants.find((item) => item.id === tenantId);

  return (
    <AppShell title={tenant?.name ?? t("contacts.title")} tab="contacts" tenantId={tenantId}>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("contacts.title")}</h2>
        <p className="muted text-sm">{t("contacts.intro")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="contact-search" className="sr-only">
          {t("contacts.search")}
        </label>
        <input
          id="contact-search"
          type="search"
          className="input min-h-11 min-w-0 flex-1"
          placeholder={t("contacts.search")}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          maxLength={100}
        />
        {data && data.total > 0 && (
          <span className="muted text-sm" role="status">
            {t("contacts.count", { count: data.total })}
          </span>
        )}
      </div>

      {(error || meError) && (
        <p className="error text-sm" role="alert">
          {t("common.error")}
        </p>
      )}
      {data === null ? (
        !error && <p className="muted text-sm">{t("common.loading")}</p>
      ) : data.contacts.length === 0 ? (
        <p className="muted py-8 text-center text-sm">{q ? t("contacts.noMatch") : t("contacts.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.contacts.map((contact) => {
            const urgent = contact.urgentRequests > 0;
            return (
              <li key={contact.id}>
                <Link
                  href={`/t/${tenantId}/contacts/${contact.id}`}
                  className="card flex flex-col gap-2 p-4 hover:bg-[var(--surface-3)]"
                  style={urgent ? { boxShadow: "inset 4px 0 0 var(--danger)" } : undefined}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    {urgent && (
                      <span className="badge" style={{ background: "#b42318", color: "#ffffff" }}>
                        {t("requests.urgent")}
                      </span>
                    )}
                    <span className={contact.name ? "font-semibold" : "muted font-semibold"} dir="auto">
                      {contact.name ?? t("contacts.unnamed")}
                    </span>
                    {contact.openRequests > 0 && (
                      <span className="badge badge-accent">
                        {t("contacts.open", { count: contact.openRequests })}
                      </span>
                    )}
                    <span className="muted ms-auto text-xs">{timeAgo(contact.lastActivityAt)}</span>
                  </span>
                  <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {contact.phone && (
                      <span dir="ltr" className="tabular-nums">
                        {formatPhone(contact.phone)}
                      </span>
                    )}
                    {contact.email && (
                      <span dir="ltr" className="min-w-0 break-all">
                        {contact.email}
                      </span>
                    )}
                  </span>
                  {contact.lastRequest && (
                    <span className="muted line-clamp-2 text-sm" dir="auto">
                      {contact.lastRequest}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
