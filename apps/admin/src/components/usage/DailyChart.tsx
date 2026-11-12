"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";

export interface DailyPoint {
  date: string;
  questions: number;
  conversations: number;
}

/** Rounds the axis maximum up to a clean number (1, 2, 5 × 10ⁿ). */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

const parseDay = (date: string) => new Date(`${date}T12:00:00`);

/**
 * One count per day: one series, so no legend (the title names it). Thin bars (≤ 24px) grow from
 * one baseline with a rounded data end; hairline gridlines; each day shows a tooltip on hover. The
 * chart is one stop for the keyboard: the arrow keys move from day to day and each day is read out
 * (a button per day would make 90 targets too small to tap). A table view carries the same numbers
 * for screen readers and exact reading.
 */
export function DailyBars<T extends { date: string }>({
  title,
  data,
  value,
  tooltip,
  columns,
  empty,
}: {
  title: string;
  data: T[];
  /** The bar's height. */
  value: (point: T) => number;
  tooltip: (point: T, date: Date) => string;
  /** Columns of the table view after the date. */
  columns: { label: string; value: (point: T) => number }[];
  /** Shown instead of the chart while every day is zero. */
  empty: string;
}) {
  const { t, language } = useI18n();
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const max = niceMax(Math.max(...data.map(value), 0));
  const ticks = [max, max / 2, 0];
  const fmtNumber = new Intl.NumberFormat(language);
  const fmtShort = new Intl.DateTimeFormat(language, { month: "short", day: "numeric" });
  const total = data.reduce((sum, d) => sum + value(d), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <button
          type="button"
          className="muted text-sm underline-offset-4 hover:underline"
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? t("usage.hideTable") : t("usage.showTable")}
        </button>
      </div>

      {total === 0 ? (
        <p className="muted text-sm">{empty}</p>
      ) : (
        <div className="flex gap-2" aria-hidden={showTable}>
          {/* Y axis: clean ticks in text tokens */}
          <div
            className="muted flex h-40 flex-col justify-between text-end text-xs tabular-nums"
            aria-hidden="true"
          >
            {ticks.map((v) => (
              <span key={v} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">
                {fmtNumber.format(v)}
              </span>
            ))}
          </div>
          <div className="relative flex-1">
            {/* Hairline gridlines */}
            <div
              className="pointer-events-none absolute inset-0 flex flex-col justify-between"
              aria-hidden="true"
            >
              {ticks.map((v) => (
                <div key={v} className="h-px bg-[var(--grid)]" />
              ))}
            </div>
            <ul
              className="relative m-0 flex h-40 list-none items-end rounded-sm p-0 outline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              style={{ gap: 2 }}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: one keyboard stop for the whole chart; the arrow keys move between days
              tabIndex={0}
              aria-label={`${title}. ${t("usage.chartKeys")}`}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive((i) => i ?? data.length - 1)}
              onBlur={() => setActive(null)}
              onKeyDown={(event) => {
                const last = data.length - 1;
                const from = active ?? last;
                const next =
                  event.key === "ArrowLeft"
                    ? Math.max(0, from - 1)
                    : event.key === "ArrowRight"
                      ? Math.min(last, from + 1)
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? last
                          : null;
                if (next === null) return;
                event.preventDefault();
                setActive(next);
              }}
            >
              {data.map((d, i) => {
                const label = tooltip(d, parseDay(d.date));
                return (
                  // Hover target = the whole day column, bigger than the bar.
                  <li
                    key={d.date}
                    className="relative flex h-full flex-1 items-end justify-center"
                    onMouseEnter={() => setActive(i)}
                  >
                    {value(d) > 0 && (
                      <span
                        className="block w-full max-w-6 rounded-t bg-[var(--chart)]"
                        style={{
                          height: `${(value(d) / max) * 100}%`,
                          opacity: active === null || active === i ? 1 : 0.55,
                        }}
                      />
                    )}
                    {active === i && (
                      <div
                        role="tooltip"
                        className="card pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap px-2 py-1 text-xs shadow-sm"
                        style={i > data.length / 2 ? { right: 0 } : { left: 0 }}
                      >
                        {label}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {/* The day the arrow keys are on, read out by screen readers. */}
            <p className="sr-only" aria-live="polite">
              {active !== null && data[active] ? tooltip(data[active]!, parseDay(data[active]!.date)) : ""}
            </p>
            {/* X axis: a few dates, muted */}
            <div className="muted mt-1 flex justify-between text-xs" aria-hidden="true">
              {[0, Math.floor((data.length - 1) / 2), data.length - 1].map((i) => (
                <span key={i}>{data[i] ? fmtShort.format(parseDay(data[i]!.date)) : ""}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {showTable && (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="muted text-start">
              <tr>
                <th className="py-1 text-start font-normal">{t("usage.date")}</th>
                {columns.map((c) => (
                  <th key={c.label} className="py-1 text-end font-normal">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...data].reverse().map((d) => (
                <tr key={d.date} className="border-t border-[var(--border)]">
                  <td className="py-1">{fmtShort.format(parseDay(d.date))}</td>
                  {columns.map((c) => (
                    <td key={c.label} className="py-1 text-end">
                      {fmtNumber.format(c.value(d))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Questions per day on the usage page. */
export function DailyChart({ data }: { data: DailyPoint[] }) {
  const { t } = useI18n();
  return (
    <DailyBars
      title={t("usage.daily")}
      data={data}
      value={(d) => d.questions}
      tooltip={(d, date) =>
        t("usage.dayTooltip", { date, questions: d.questions, conversations: d.conversations })
      }
      columns={[
        { label: t("usage.questions"), value: (d) => d.questions },
        { label: t("usage.conversations"), value: (d) => d.conversations },
      ]}
      empty={t("usage.noData")}
    />
  );
}
