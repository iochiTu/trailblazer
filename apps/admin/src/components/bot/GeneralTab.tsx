"use client";

import { getLanguage } from "@traiblazer/i18n";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { ApiError, api, type BotDetail, type Language } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Matches the API limit (shared schema): up to 6 suggested questions per language. */
const MAX_QUICK_REPLIES = 6;
const TIERS = [1, 2, 3] as const;

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        {hint && <p className="muted text-sm">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * General settings: names, languages and the texts visitors see (greeting, suggested questions,
 * launcher text). Visual settings live in the Appearance tab.
 */
export function GeneralTab({
  detail,
  base,
  onChange,
}: {
  detail: BotDetail;
  base: string;
  onChange: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { bot } = detail;
  const settings = bot.settings;
  const businessName = detail.profile?.businessName ?? bot.name;

  const [catalog, setCatalog] = useState<Language[]>([]);
  const [enabled, setEnabled] = useState<string[]>(bot.languages);
  const [defaultLanguage, setDefaultLanguage] = useState(bot.defaultLanguage);
  const [answerOthers, setAnswerOthers] = useState(settings.answerOtherLanguages !== false);
  const [showQuickReplies, setShowQuickReplies] = useState(
    () =>
      !bot.languages.every(
        (code) => Array.isArray(settings.quickReplies?.[code]) && settings.quickReplies[code].length === 0,
      ),
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ languages: Language[] }>("/v1/catalog/languages").then((d) =>
      // Owner-only languages (e.g. Indigenous languages) need owner-provided phrases; not offered here yet.
      setCatalog(d.languages.filter((l) => l.tier !== "owner")),
    );
  }, []);

  // Enabled languages in catalog order (the order visitors see in the chat's language menu).
  const ordered = catalog.length
    ? catalog.filter((l) => enabled.includes(l.code)).map((l) => l.code)
    : enabled;

  function toggle(code: string, on: boolean) {
    setError(null);
    if (!on && enabled.length === 1) {
      setError(t("general.atLeastOne"));
      return;
    }
    const next = on ? [...enabled, code] : enabled.filter((c) => c !== code);
    setEnabled(next);
    if (!next.includes(defaultLanguage)) setDefaultLanguage(next[0]!);
  }

  const defaultQuickReplies = (code: string) =>
    detail.defaults.quickReplies[code] ?? detail.defaults.quickReplies[code === "fr" ? "fr" : "en"] ?? [];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    // Texts for languages that are turned off are kept, so turning a language back on restores them.
    const greeting: Record<string, string> = { ...settings.greeting };
    const quickReplies: Record<string, string[]> = { ...settings.quickReplies };
    for (const code of ordered) {
      const text = String(data.get(`greeting.${code}`) ?? "").trim();
      if (text) greeting[code] = text;
      else delete greeting[code];

      // Suggested questions: an owner list, nothing (= industry defaults), or [] to hide them.
      if (!showQuickReplies) {
        quickReplies[code] = [];
        continue;
      }
      const lines = String(data.get(`quickReplies.${code}`) ?? "")
        .split("\n")
        .map((line) => line.trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, MAX_QUICK_REPLIES);
      if (lines.length) quickReplies[code] = lines;
      else delete quickReplies[code];
    }

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api(base, {
        method: "PATCH",
        body: {
          name: String(data.get("name") ?? "").trim() || bot.name,
          languages: ordered,
          defaultLanguage,
          settings: {
            assistantName: String(data.get("assistantName") ?? ""),
            answerOtherLanguages: answerOthers,
            greeting,
            quickReplies,
            launcherLabel: String(data.get("launcherLabel") ?? ""),
          },
        },
      });
      await onChange();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex max-w-3xl flex-col gap-8" onSubmit={onSubmit}>
      <Section title={t("general.names")}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("general.assistantName")}</span>
          <input
            className="input max-w-sm"
            name="assistantName"
            maxLength={40}
            defaultValue={settings.assistantName ?? ""}
            placeholder={businessName}
            dir="auto"
          />
          <span className="muted text-xs">{t("general.assistantNameHint")}</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("general.botName")}</span>
          <input className="input max-w-sm" name="name" required maxLength={80} defaultValue={bot.name} />
          <span className="muted text-xs">{t("general.botNameHint")}</span>
        </label>
      </Section>

      <Section title={t("general.languages")} hint={t("general.languagesHint")}>
        {TIERS.map((tier) => {
          const list = catalog.filter((l) => l.tier === tier);
          if (!list.length) return null;
          return (
            <fieldset key={tier} className="flex flex-col gap-2">
              <legend className="mb-1 text-sm">{t(`general.languages.tier${tier}`)}</legend>
              <div className="flex flex-wrap gap-2">
                {list.map((lang) => (
                  <label key={lang.code} className="chip" title={lang.englishName}>
                    <input
                      type="checkbox"
                      checked={enabled.includes(lang.code)}
                      onChange={(e) => toggle(lang.code, e.target.checked)}
                    />
                    <span dir={lang.dir}>{lang.nativeName}</span>
                    {lang.nativeName !== lang.englishName && (
                      <span className="muted text-xs">{lang.englishName}</span>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("general.defaultLanguage")}</span>
          <select
            className="input max-w-xs"
            value={defaultLanguage}
            onChange={(e) => setDefaultLanguage(e.target.value)}
          >
            {ordered.map((code) => (
              <option key={code} value={code}>
                {getLanguage(code)?.nativeName ?? code}
              </option>
            ))}
          </select>
          <span className="muted text-xs">{t("general.defaultLanguageHint")}</span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={answerOthers}
            onChange={(e) => setAnswerOthers(e.target.checked)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{t("general.otherLanguages")}</span>
            <span className="muted text-xs">{t("general.otherLanguagesHint")}</span>
          </span>
        </label>
      </Section>

      <Section title={t("general.messages")}>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t("general.greeting")}</legend>
          <span className="muted text-xs">{t("general.greetingHint")}</span>
          {ordered.map((code) => {
            const lang = getLanguage(code);
            return (
              <label key={code} className="flex flex-col gap-1 text-sm">
                <span>{lang?.nativeName ?? code}</span>
                <textarea
                  className="input"
                  name={`greeting.${code}`}
                  rows={2}
                  maxLength={300}
                  dir={lang?.dir ?? "auto"}
                  defaultValue={settings.greeting?.[code] ?? ""}
                />
              </label>
            );
          })}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t("general.quickReplies")}</legend>
          <span className="muted text-xs">{t("general.quickRepliesHint", { max: MAX_QUICK_REPLIES })}</span>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showQuickReplies}
              onChange={(e) => setShowQuickReplies(e.target.checked)}
            />
            {t("general.quickRepliesShow")}
          </label>
          {showQuickReplies &&
            ordered.map((code) => {
              const lang = getLanguage(code);
              return (
                <label key={code} className="flex flex-col gap-1 text-sm">
                  <span>{lang?.nativeName ?? code}</span>
                  <textarea
                    className="input"
                    name={`quickReplies.${code}`}
                    rows={3}
                    dir={lang?.dir ?? "auto"}
                    placeholder={defaultQuickReplies(code).join("\n")}
                    defaultValue={settings.quickReplies?.[code]?.join("\n") ?? ""}
                  />
                </label>
              );
            })}
        </fieldset>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("general.launcher")}</span>
          <span>{t("general.launcherLabel")}</span>
          <input
            className="input max-w-xs"
            name="launcherLabel"
            maxLength={30}
            defaultValue={settings.launcherLabel ?? ""}
            dir="auto"
          />
          <span className="muted text-xs">{t("general.launcherLabelHint")}</span>
        </label>
      </Section>

      <div className="flex items-center gap-3">
        <button className="btn" type="submit" disabled={busy}>
          {t("common.save")}
        </button>
        {saved && (
          <span className="text-sm" role="status" style={{ color: "var(--accent)" }}>
            {t("common.saved")}
          </span>
        )}
        {error && (
          <span className="error text-sm" role="alert">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
