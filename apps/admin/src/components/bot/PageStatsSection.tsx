"use client";

import type { MessageKey } from "@traiblazer/i18n";
import { useEffect, useState } from "react";
import { DailyBars } from "@/components/usage/DailyChart";
import { api, type PageAction, type PageStats } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const PERIODS = [7, 30, 90] as const;
const ACTIONS: PageAction[] = ["call", "book", "email", "directions", "website", "link"];

function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="muted text-sm">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {note && <span className="muted text-xs">{note}</span>}
    </div>
  );
}

/**
 * How the business page is doing: views, taps on its contact buttons, questions visitors asked the
 * assistant and requests they left. Counts only; nothing about who visited.
 */
export function PageStatsSection({ base }: { base: string }) {
  const { t, language } = useI18n();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [stats, setStats] = useState<PageStats | null>(null);
  const [error, setError] = useState(false);
  const fmt = new Intl.NumberFormat(language);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    api<PageStats>(`${base}/page-stats?days=${days}`)
      .then((result) => !cancelled && setStats(result))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [base, days]);

  const totals = stats?.totals;
  const taps = totals ? ACTIONS.reduce((n, action) => n + totals.taps[action], 0) : 0;
  const tapRows = totals
    ? ACTIONS.filter((action) => totals.taps[action] > 0).sort((a, b) => totals.taps[b] - totals.taps[a])
    : [];

  return (
    <section className="panel flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="page-stats-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h3 id="page-stats-title" className="text-lg font-semibold">
            {t("pageStats.title")}
          </h3>
          <p className="muted text-sm">{t("pageStats.hint")}</p>
        </div>
        <fieldset className="flex gap-2">
          <legend className="sr-only">{t("pageStats.period")}</legend>
          {PERIODS.map((period) => (
            <button
              key={period}
              type="button"
              className="chip"
              data-selected={days === period}
              aria-pressed={days === period}
              onClick={() => setDays(period)}
            >
              {t("pageStats.days", { days: period })}
            </button>
          ))}
        </fieldset>
      </div>

      {error && (
        <p className="error text-sm" role="alert">
          {t("common.error")}
        </p>
      )}

      {totals && stats && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label={t("pageStats.views")} value={fmt.format(totals.views)} />
            <StatTile label={t("pageStats.taps")} value={fmt.format(taps)} note={t("pageStats.tapsNote")} />
            <StatTile
              label={t("pageStats.questions")}
              value={fmt.format(totals.questions)}
              note={t("pageStats.questionsNote", { conversations: totals.conversations })}
            />
            <StatTile
              label={t("pageStats.requests")}
              value={fmt.format(totals.requests)}
              note={
                totals.urgentRequests
                  ? t("pageStats.urgentNote", { urgent: totals.urgentRequests })
                  : undefined
              }
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <DailyBars
              title={t("pageStats.daily", { days: stats.days })}
              data={stats.daily}
              value={(d) => d.views}
              tooltip={(d, date) => t("pageStats.dayTooltip", { date, views: d.views, taps: d.taps })}
              columns={[
                { label: t("pageStats.views"), value: (d) => d.views },
                { label: t("pageStats.taps"), value: (d) => d.taps },
                { label: t("pageStats.questions"), value: (d) => d.questions },
                { label: t("pageStats.requests"), value: (d) => d.requests },
              ]}
              empty={t("pageStats.noViews")}
            />
            <div className="flex flex-col gap-2">
              <h4 className="font-medium">{t("pageStats.byButton")}</h4>
              {tapRows.length ? (
                <table className="w-full text-sm">
                  <tbody className="tabular-nums">
                    {tapRows.map((action) => (
                      <tr key={action} className="border-t border-[var(--border)] first:border-t-0">
                        <td className="py-1">{t(`pageStats.action.${action}` as MessageKey)}</td>
                        <td className="py-1 text-end">{fmt.format(totals.taps[action])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted text-sm">{t("pageStats.noTaps")}</p>
              )}
            </div>
          </div>
          <p className="muted text-xs">{t("pageStats.privacy")}</p>
        </>
      )}
    </section>
  );
}
