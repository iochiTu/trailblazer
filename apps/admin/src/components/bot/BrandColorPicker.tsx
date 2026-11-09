"use client";

import { BRAND_COLOR_PRESETS, findColorPreset, isHexColor, textOn } from "@traiblazer/appearance";
import { type FormEvent, useState } from "react";
import { useI18n } from "@/lib/i18n";

/**
 * Brand color: a row of ready-made colors for most businesses, plus a custom color (picker and
 * hex code) for advanced users. Text colors are derived elsewhere, so any choice stays readable.
 */
export function BrandColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const { t, language } = useI18n();
  const lang2 = language === "fr" ? "fr" : "en";
  const preset = findColorPreset(value);
  const [customOpen, setCustomOpen] = useState(!preset);
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);

  function applyCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = draft.trim().startsWith("#") ? draft.trim() : `#${draft.trim()}`;
    if (!isHexColor(normalized)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(normalized.toLowerCase());
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {BRAND_COLOR_PRESETS.map((p) => {
          const selected = preset?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={selected}
              aria-label={p.name[lang2]}
              title={p.name[lang2]}
              onClick={() => {
                setDraft(p.color);
                setInvalid(false);
                setCustomOpen(false);
                onChange(p.color);
              }}
              className={`flex h-9 w-9 items-center justify-center rounded-full border-2 ${
                selected ? "border-[var(--text)]" : "border-transparent"
              }`}
              style={{ background: p.color, color: textOn(p.color), outlineOffset: 2 }}
            >
              {selected && <span aria-hidden="true">✓</span>}
            </button>
          );
        })}
        <button
          type="button"
          aria-expanded={customOpen}
          onClick={() => setCustomOpen((open) => !open)}
          className={`flex h-9 items-center gap-2 rounded-full border-2 px-3 text-sm ${
            !preset ? "border-[var(--text)]" : "border-[var(--border)]"
          }`}
        >
          <span
            aria-hidden="true"
            className="h-4 w-4 rounded-full"
            style={{
              background: preset
                ? "conic-gradient(#e11d48, #f59e0b, #16a34a, #2563eb, #7c3aed, #e11d48)"
                : value,
            }}
          />
          {t("appearance.customColor")}
        </button>
      </div>

      {customOpen && (
        <form className="panel flex flex-col gap-2 p-4" onSubmit={applyCustom}>
          <span className="muted text-xs">{t("appearance.customColorHint")}</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              className="h-10 w-12 cursor-pointer rounded-xl border border-[var(--border)] bg-[var(--surface)]"
              value={isHexColor(draft) ? draft : value}
              aria-label={t("appearance.customColor")}
              onChange={(e) => {
                setDraft(e.target.value);
                setInvalid(false);
              }}
            />
            <input
              className="input font-mono"
              // .input is full-width by default; keep the hex field compact.
              style={{ width: "8.5rem" }}
              dir="ltr"
              value={draft}
              maxLength={7}
              spellCheck={false}
              aria-label={t("appearance.hexCode")}
              aria-invalid={invalid}
              onChange={(e) => {
                setDraft(e.target.value);
                setInvalid(false);
              }}
            />
            {isHexColor(draft) && (
              <span
                className="rounded-full px-3 py-1 text-sm font-medium"
                style={{ background: draft, color: textOn(draft) }}
                aria-hidden="true"
              >
                Aa
              </span>
            )}
            <button type="submit" className="btn">
              {t("appearance.apply")}
            </button>
          </div>
          {invalid && (
            <span className="error text-xs" role="alert">
              {t("appearance.invalidColor")}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
