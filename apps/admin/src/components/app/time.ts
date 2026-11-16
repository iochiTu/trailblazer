"use client";

import { useI18n } from "@/lib/i18n";

/** "5 min ago", "yesterday"… for the list. */
export function useTimeAgo() {
  const { language } = useI18n();
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: "auto", style: "short" });
  return (iso: string) => {
    const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
    const steps: [Intl.RelativeTimeFormatUnit, number][] = [
      ["second", 60],
      ["minute", 60],
      ["hour", 24],
      ["day", 7],
      ["week", 4.35],
      ["month", 12],
    ];
    let value = seconds;
    for (const [unit, size] of steps) {
      if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
      value /= size;
    }
    return rtf.format(Math.round(value), "year");
  };
}
