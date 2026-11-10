"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type BotDetail, type Lead, type LeadStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Filter = "open" | "done" | "all";
const FILTERS: Filter[] = ["open", "done", "all"];

/**
 * Requests visitors left with the assistant (call me back, send a quote…): who, how to reach them,
 * what they want. Staff work through them here; each links back to its conversation.
 */
export function RequestsTab({
  detail,
  base,
  onChange,
  onCount,
  onOpenConversation,
}: {
  detail: BotDetail;
  base: string;
  /** Reloads the assistant after its settings change. */
  onChange: () => Promise<void>;
  /** Reports how many requests are new (shown on the tab). */
  onCount: (newCount: number) => void;
  onOpenConversation: (conversationId: string) => void;
}) {
  const { t, language } = useI18n();
  const [list, setList] = useState<Lead[] | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [error, setError] = useState<string | null>(null);
  const enabled = detail.bot.settings.followUps !== false;

  const load = useCallback(async () => {
    const data = await api<{ leads: Lead[]; newCount: number }>(`${base}/leads`);
    setList(data.leads);
    onCount(data.newCount);
  }, [base, onCount]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs a change, then reloads; shows the server's message when it's refused (e.g. view-only members). */
  async function change(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  const setStatus = (lead: Lead, status: LeadStatus) =>
    change(() => api(`${base}/leads/${lead.id}`, { method: "PATCH", body: { status } }));

  function remove(lead: Lead) {
    if (!window.confirm(t("requests.deleteConfirm", { name: lead.name }))) return;
    void change(() => api(`${base}/leads/${lead.id}`, { method: "DELETE" }));
  }

  const toggle = (on: boolean) =>
    change(async () => {
      await api(base, { method: "PATCH", body: { settings: { followUps: on } } });
      await onChange();
    });

  const fmt = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  const shown = (list ?? []).filter((lead) =>
    filter === "all" ? true : filter === "done" ? lead.status === "done" : lead.status !== "done",
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <p className="muted max-w-3xl text-sm">{t("requests.intro")}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} />
          <span className="font-medium">{t("requests.enable")}</span>
        </label>
      </div>

      {error && (
        <p className="error text-sm" role="alert">
          {error}
        </p>
      )}

      {list === null ? (
        <p className="muted text-sm">{t("common.loading")}</p>
      ) : !list.length ? (
        <p className="muted text-sm">{t("requests.empty")}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((id) => (
              <button
                key={id}
                type="button"
                className="chip"
                data-selected={filter === id}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {t(`requests.filter.${id}`)}
              </button>
            ))}
          </div>

          {!shown.length && <p className="muted text-sm">{t("requests.emptyFilter")}</p>}
          <ul className="flex flex-col gap-3">
            {shown.map((lead) => (
              <li key={lead.id} className="panel flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold" dir="auto">
                    {lead.name}
                  </span>
                  <span className="badge">{t(`requests.kind.${lead.kind}`)}</span>
                  <span className={lead.status === "new" ? "badge badge-accent" : "badge"}>
                    {t(`requests.status.${lead.status}`)}
                  </span>
                  {lead.channel === "playground" && <span className="badge">{t("requests.test")}</span>}
                  <span className="muted ms-auto text-xs">{fmt.format(new Date(lead.createdAt))}</span>
                </div>

                <p className="text-sm whitespace-pre-wrap" dir="auto">
                  {lead.message}
                </p>

                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  {lead.email && (
                    <a className="underline" href={`mailto:${lead.email}`} dir="ltr">
                      {lead.email}
                    </a>
                  )}
                  {lead.phone && (
                    <a className="underline" href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} dir="ltr">
                      {lead.phone}
                    </a>
                  )}
                  {lead.bestTime && (
                    <span className="muted" dir="auto">
                      {t("requests.bestTime", { time: lead.bestTime })}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {lead.status === "new" && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setStatus(lead, "in_progress")}
                    >
                      {t("requests.start")}
                    </button>
                  )}
                  {lead.status !== "done" ? (
                    <button type="button" className="btn" onClick={() => setStatus(lead, "done")}>
                      {t("requests.finish")}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-ghost" onClick={() => setStatus(lead, "new")}>
                      {t("requests.reopen")}
                    </button>
                  )}
                  {lead.conversationId && (
                    <button
                      type="button"
                      className="btn-text text-sm"
                      onClick={() => onOpenConversation(lead.conversationId!)}
                    >
                      {t("requests.viewConversation")}
                    </button>
                  )}
                  <button type="button" className="btn-text ms-auto text-sm" onClick={() => remove(lead)}>
                    {t("common.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
