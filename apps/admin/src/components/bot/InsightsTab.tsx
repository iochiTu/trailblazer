"use client";

import type { MessageKey } from "@traiblazer/i18n";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { ApiError, api, type Insights, type PublicPlan } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { PageStatsSection } from "./PageStatsSection";

const PERIODS = [7, 30, 90] as const;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
/** Hours grouped in blocks of three, so the grid fits a phone. */
const BLOCKS = [0, 3, 6, 9, 12, 15, 18, 21] as const;

/** Statistics for everyone, then Insights (premium) for plans that include it. */
export function InsightsTab({ base, onOpenKnowledge }: { base: string; onOpenKnowledge: () => void }) {
  return (
    <div className="flex flex-col gap-8">
      <PageStatsSection base={base} />
      <InsightsSection base={base} onOpenKnowledge={onOpenKnowledge} />
    </div>
  );
}

function useFormats() {
  const { language } = useI18n();
  const number = new Intl.NumberFormat(language);
  const percent = new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 });
  return {
    number: (n: number) => number.format(n),
    /** A share, or a dash when there is nothing to divide by. */
    rate: (part: number, whole: number) => (whole > 0 ? percent.format(part / whole) : "–"),
  };
}

/** A thin horizontal bar for one row of a table (the numbers sit in their own cells). */
function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 w-full min-w-8" aria-hidden="true">
      {value > 0 && (
        <div
          className="h-2 rounded-e bg-[var(--chart)]"
          style={{ width: `${Math.max(2, (value / Math.max(max, 1)) * 100)}%` }}
        />
      )}
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h4 className="font-medium">{title}</h4>
        {hint && <p className="muted text-sm">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** A table whose first number column is also drawn as a bar. */
function BarTable({
  head,
  rows,
}: {
  head: [string, string, ...string[]];
  rows: { key: string; label: string; value: number; cells: string[] }[];
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  const { number } = useFormats();
  return (
    // Scrolls inside its box on narrow phones rather than widening the page.
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="muted">
            <th scope="col" className="py-1 text-start font-normal">
              {head[0]}
            </th>
            <th scope="col" className="w-2/5 py-1">
              <span className="sr-only">{head[1]}</span>
            </th>
            <th scope="col" className="py-1 ps-2 sm:ps-3 text-end font-normal">
              {head[1]}
            </th>
            {head.slice(2).map((h) => (
              <th key={h} scope="col" className="py-1 ps-2 sm:ps-3 text-end font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-[var(--border)]">
              <th scope="row" className="py-1.5 pe-2 sm:pe-3 text-start font-normal" dir="auto">
                {row.label}
              </th>
              <td className="py-1.5">
                <Bar value={row.value} max={max} />
              </td>
              <td className="py-1.5 ps-2 sm:ps-3 text-end">{number(row.value)}</td>
              {row.cells.map((cell, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns
                <td key={i} className="py-1.5 ps-2 sm:ps-3 text-end">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="muted text-sm">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {note && <span className="muted text-xs">{note}</span>}
    </div>
  );
}

function Locked() {
  const { t, language } = useI18n();
  const [plans, setPlans] = useState<string[]>([]);
  useEffect(() => {
    api<{ plans: PublicPlan[] }>("/v1/catalog/plans")
      .then((r) =>
        setPlans(r.plans.filter((p) => p.insights).map((p) => (language === "fr" ? p.nameFr : p.nameEn))),
      )
      .catch(() => {});
  }, [language]);
  const list = new Intl.ListFormat(language, { type: "conjunction" }).format(plans);
  return (
    <div className="flex flex-col gap-3">
      <span className="badge badge-accent self-start">{t("insights.premium")}</span>
      <p className="max-w-2xl text-sm">{t("insights.locked.body")}</p>
      <ul className="ms-5 list-disc text-sm">
        {(["funnel", "channels", "intents", "blockers", "sentiment", "busy"] as const).map((k) => (
          <li key={k}>{t(`insights.locked.${k}` as MessageKey)}</li>
        ))}
      </ul>
      {plans.length > 0 && <p className="muted text-sm">{t("insights.locked.plans", { plans: list })}</p>}
      <Link href={`/${language}/pricing`} className="btn self-start">
        {t("insights.locked.cta")}
      </Link>
    </div>
  );
}

function BusyTimes({ data }: { data: Insights["busyTimes"] }) {
  const { t, language } = useI18n();
  const { number } = useFormats();
  const cell = (weekday: number, from: number) =>
    data
      .filter((d) => d.weekday === weekday && d.hour >= from && d.hour < from + 3)
      .reduce((n, d) => n + d.n, 0);
  const max = Math.max(0, ...WEEKDAYS.flatMap((w) => BLOCKS.map((b) => cell(w, b))));
  // 2024-01-01 was a Monday.
  const dayName = (w: number) =>
    new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" }).format(Date.UTC(2024, 0, w));
  const hourName = (h: number) =>
    new Intl.DateTimeFormat(language, { hour: "numeric", timeZone: "UTC" }).format(Date.UTC(2024, 0, 1, h));
  if (max === 0) return <p className="muted text-sm">{t("insights.empty")}</p>;
  return (
    <table className="w-full table-fixed text-xs">
      <thead>
        <tr className="muted">
          <th scope="col" className="w-12 py-1 font-normal">
            <span className="sr-only">{t("insights.busy.day")}</span>
          </th>
          {BLOCKS.map((b) => (
            <th key={b} scope="col" className="py-1 text-start font-normal">
              {hourName(b)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {WEEKDAYS.map((w) => (
          <tr key={w}>
            <th scope="row" className="muted py-0.5 pe-2 text-start font-normal">
              {dayName(w)}
            </th>
            {BLOCKS.map((b) => {
              const n = cell(w, b);
              return (
                <td key={b} className="p-0.5">
                  <div
                    className="relative h-7 rounded bg-[var(--grid)]"
                    title={t("insights.busy.tooltip", { day: dayName(w), hour: hourName(b), count: n })}
                  >
                    {n > 0 && (
                      <div
                        className="absolute inset-0 rounded bg-[var(--chart)]"
                        style={{ opacity: 0.15 + 0.85 * (n / max) }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="sr-only">{number(n)}</span>
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Insights (premium BI): conversion funnel, what visitors want, why they don't convert. */
function InsightsSection({ base, onOpenKnowledge }: { base: string; onOpenKnowledge: () => void }) {
  const { t, language } = useI18n();
  const { number, rate } = useFormats();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [data, setData] = useState<Insights | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "locked" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    api<Insights>(`${base}/insights?days=${days}`)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setState(err instanceof ApiError && err.code === "plan_required" ? "locked" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [base, days]);

  const languageName = (code: string) => {
    if (code === "unknown") return t("insights.unknown");
    try {
      return new Intl.DisplayNames([language], { type: "language" }).of(code) ?? code;
    } catch {
      return code;
    }
  };

  const f = data?.funnel.current;
  const p = data?.funnel.previous;
  /** Change in percentage points of the conversion rate, against the period before. */
  const pointsChange = (now: number, nowOf: number, then: number, thenOf: number) => {
    if (!nowOf || !thenOf) return undefined;
    const points = Math.round((now / nowOf - then / thenOf) * 100);
    const change = new Intl.NumberFormat(language, { signDisplay: "exceptZero" }).format(points);
    return t("insights.vsPrevious", { change, days: data?.days ?? days });
  };
  const blockers = data ? Object.entries(data.blockers).sort((a, b) => b[1] - a[1]) : [];
  const sentiment = data
    ? data.sentiment.reduce(
        (sum, d) => ({
          positive: sum.positive + d.positive,
          neutral: sum.neutral + d.neutral,
          negative: sum.negative + d.negative,
        }),
        { positive: 0, neutral: 0, negative: 0 },
      )
    : null;
  const felt = sentiment ? sentiment.positive + sentiment.neutral + sentiment.negative : 0;

  return (
    <section className="panel flex flex-col gap-5 p-4 sm:p-5" aria-labelledby="insights-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h3 id="insights-title" className="text-lg font-semibold">
            {t("insights.title")}
          </h3>
          <p className="muted text-sm">{t("insights.hint")}</p>
        </div>
        {state !== "locked" && (
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
        )}
      </div>

      {state === "loading" && <p className="muted text-sm">{t("common.loading")}</p>}
      {state === "error" && (
        <p className="error text-sm" role="alert">
          {t("common.error")}
        </p>
      )}
      {state === "locked" && <Locked />}

      {state === "ready" && data && f && p && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label={t("insights.conversion")}
              value={rate(f.requests, f.conversations)}
              note={
                pointsChange(f.requests, f.conversations, p.requests, p.conversations) ??
                t("insights.conversionNote")
              }
            />
            <Tile
              label={t("insights.engagement")}
              value={rate(f.conversations, f.views)}
              note={
                pointsChange(f.conversations, f.views, p.conversations, p.views) ??
                t("insights.engagementNote")
              }
            />
            <Tile
              label={t("insights.conversations")}
              value={number(f.conversations)}
              note={t("insights.before", { count: p.conversations })}
            />
            <Tile
              label={t("insights.requests")}
              value={number(f.requests)}
              note={t("insights.before", { count: p.requests })}
            />
          </div>

          <Block title={t("insights.funnel.title")} hint={t("insights.funnel.hint")}>
            <BarTable
              head={[t("insights.funnel.step"), t("insights.count"), t("insights.rate")]}
              rows={(
                [
                  ["views", f.views],
                  ["conversations", f.conversations],
                  ["offered", f.offered],
                  ["taps", f.taps],
                  ["requests", f.requests],
                ] as const
              ).map(([step, value]) => ({
                key: step,
                label: t(`insights.funnel.${step}` as MessageKey),
                value,
                // Visitors don't all go through every step (a request can come straight from a
                // question), so only the two rates that hold are shown.
                cells: [
                  step === "conversations"
                    ? rate(value, f.views)
                    : step === "requests"
                      ? rate(value, f.conversations)
                      : "",
                ],
              }))}
            />
          </Block>

          <div className="grid gap-6 lg:grid-cols-2">
            <Block title={t("insights.channels.title")}>
              {data.channels.length ? (
                <BarTable
                  head={[
                    t("insights.channels.channel"),
                    t("insights.conversations"),
                    t("insights.requests"),
                    t("insights.rate"),
                  ]}
                  rows={data.channels.map((c) => ({
                    key: c.channel,
                    label: t(`insights.channels.${c.channel}` as MessageKey),
                    value: c.conversations,
                    cells: [number(c.requests), rate(c.requests, c.conversations)],
                  }))}
                />
              ) : (
                <p className="muted text-sm">{t("insights.empty")}</p>
              )}
            </Block>
            <Block title={t("insights.languages.title")}>
              {data.languages.length ? (
                <BarTable
                  head={[
                    t("insights.languages.language"),
                    t("insights.conversations"),
                    t("insights.requests"),
                    t("insights.rate"),
                  ]}
                  rows={data.languages.map((l) => ({
                    key: l.language,
                    label: languageName(l.language),
                    value: l.conversations,
                    cells: [number(l.requests), rate(l.requests, l.conversations)],
                  }))}
                />
              ) : (
                <p className="muted text-sm">{t("insights.empty")}</p>
              )}
            </Block>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Block title={t("insights.intents.title")} hint={t("insights.intents.hint")}>
              {data.intents.length ? (
                <BarTable
                  head={[t("insights.intents.intent"), t("insights.conversations"), t("insights.rate")]}
                  rows={data.intents.map((i) => ({
                    key: i.intent,
                    label: t(`insights.intent.${i.intent}` as MessageKey),
                    value: i.conversations,
                    cells: [rate(i.requests, i.conversations)],
                  }))}
                />
              ) : (
                <p className="muted text-sm">{t("insights.notAnalyzed")}</p>
              )}
            </Block>
            <Block title={t("insights.blockers.title")} hint={t("insights.blockers.hint")}>
              {blockers.length ? (
                <>
                  <BarTable
                    head={[t("insights.blockers.reason"), t("insights.conversations")]}
                    rows={blockers.map(([reason, n]) => ({
                      key: reason,
                      label: t(`insights.blocker.${reason}` as MessageKey),
                      value: n,
                      cells: [],
                    }))}
                  />
                  {(data.blockers.no_answer ?? 0) > 0 && data.openGaps > 0 && (
                    <p className="text-sm">
                      {t("insights.blockers.gaps", { count: data.openGaps })}{" "}
                      <button
                        type="button"
                        className="underline underline-offset-4"
                        onClick={onOpenKnowledge}
                      >
                        {t("insights.blockers.gapsLink")}
                      </button>
                    </p>
                  )}
                </>
              ) : (
                <p className="muted text-sm">{t("insights.notAnalyzed")}</p>
              )}
            </Block>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
            <Block title={t("insights.sentiment.title")}>
              {sentiment && felt > 0 ? (
                <BarTable
                  head={[t("insights.sentiment.feeling"), t("insights.conversations"), t("insights.share")]}
                  rows={(["positive", "neutral", "negative"] as const).map((k) => ({
                    key: k,
                    label: t(`insights.sentiment.${k}` as MessageKey),
                    value: sentiment[k],
                    cells: [rate(sentiment[k], felt)],
                  }))}
                />
              ) : (
                <p className="muted text-sm">{t("insights.notAnalyzed")}</p>
              )}
            </Block>
            <Block title={t("insights.busy.title")} hint={t("insights.busy.hint")}>
              <BusyTimes data={data.busyTimes} />
            </Block>
          </div>

          <p className="muted text-xs">
            {t("insights.analyzed", { count: data.analyzed })} {t("insights.privacy")}
          </p>
        </>
      )}
    </section>
  );
}
