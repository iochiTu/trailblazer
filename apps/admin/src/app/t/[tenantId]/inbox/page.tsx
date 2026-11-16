"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { useTimeAgo } from "@/components/app/time";
import { rememberTenant, useMe } from "@/components/app/useMe";
import { ApiError, api, type InboxLead } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Filter = "open" | "done" | "all";
const FILTERS: Filter[] = ["open", "done", "all"];
/** How often an open inbox looks for new requests. */
const REFRESH_MS = 30_000;

/**
 * The owner app's first screen (PLAN §20.2): every request the business's assistants took,
 * urgent ones still to do on top. Tapping one opens it, with call / text buttons and notes.
 */
export default function InboxPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { tenantId } = useParams<{ tenantId: string }>();
  const { me, error: meError } = useMe();
  const [filter, setFilter] = useState<Filter>("open");
  const [data, setData] = useState<{ leads: InboxLead[]; newCount: number; urgentCount: number } | null>(
    null,
  );
  const [error, setError] = useState(false);
  const timeAgo = useTimeAgo();

  const load = useCallback(async () => {
    try {
      setData(await api(`/v1/tenants/${tenantId}/inbox?status=${filter}`));
      setError(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) router.replace("/inbox");
      else setError(true);
    }
  }, [tenantId, filter, router]);

  useEffect(() => {
    rememberTenant(tenantId);
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    // Back from the lock screen or another app: show what came in meanwhile.
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tenantId, load]);

  const tenants = me?.tenants ?? [];
  const tenant = tenants.find((item) => item.id === tenantId);
  const manyAssistants = new Set(data?.leads.map((l) => l.botId)).size > 1;

  return (
    <AppShell
      title={tenant?.name ?? t("inbox.title")}
      tab="inbox"
      tenantId={tenantId}
      action={
        <button
          type="button"
          className="btn btn-ghost min-h-11 px-3"
          onClick={() => void load()}
          aria-label={t("inbox.refresh")}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
          </svg>
        </button>
      }
    >
      {tenants.length > 1 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="muted">{t("inbox.business")}</span>
          <select
            className="input"
            value={tenantId}
            onChange={(e) => router.push(`/t/${e.target.value}/inbox`)}
          >
            {tenants.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            className="chip min-h-10"
            data-selected={filter === id}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {t(`requests.filter.${id}`)}
          </button>
        ))}
        {data && (data.urgentCount > 0 || data.newCount > 0) && (
          <span className="muted ms-auto text-sm" role="status">
            {[
              data.urgentCount > 0 ? t("inbox.urgentCount", { count: data.urgentCount }) : null,
              data.newCount > 0 ? t("inbox.newCount", { count: data.newCount }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
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
      ) : data.leads.length === 0 ? (
        <p className="muted py-8 text-center text-sm">
          {filter === "open" ? t("inbox.empty") : t("inbox.emptyFilter")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.leads.map((lead) => {
            const urgent = lead.urgent && lead.status !== "done";
            return (
              <li key={lead.id}>
                <Link
                  href={`/t/${tenantId}/inbox/${lead.botId}/${lead.id}`}
                  className="card flex flex-col gap-2 p-4 hover:bg-[var(--surface-3)]"
                  style={urgent ? { boxShadow: "inset 4px 0 0 var(--danger)" } : undefined}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    {urgent && (
                      <span className="badge" style={{ background: "#b42318", color: "#ffffff" }}>
                        {t("requests.urgent")}
                      </span>
                    )}
                    <span className="font-semibold" dir="auto">
                      {lead.name}
                    </span>
                    <span className="badge">{t(`requests.kind.${lead.kind}`)}</span>
                    {lead.status !== "done" && (
                      <span className={lead.status === "new" ? "badge badge-accent" : "badge"}>
                        {t(`requests.status.${lead.status}`)}
                      </span>
                    )}
                    <span className="muted ms-auto text-xs">{timeAgo(lead.createdAt)}</span>
                  </span>
                  <span className="line-clamp-2 text-sm" dir="auto">
                    {lead.message}
                  </span>
                  <span className="muted flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {manyAssistants && <span dir="auto">{lead.businessName ?? lead.botName}</span>}
                    {lead.attachmentIds.length > 0 && (
                      <span>📷 {t("inbox.photos", { count: lead.attachmentIds.length })}</span>
                    )}
                    {lead.comments > 0 && <span>💬 {t("inbox.notes", { count: lead.comments })}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
