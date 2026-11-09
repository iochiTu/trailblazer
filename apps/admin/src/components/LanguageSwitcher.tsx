"use client";

import { getLanguage, uiLanguages } from "@traiblazer/i18n";
import { setUiLanguage, useI18n } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { language, t } = useI18n();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="muted">{t("common.language")}</span>
      <select
        className="input w-auto py-1.5"
        value={language}
        onChange={(e) => setUiLanguage(e.target.value)}
        aria-label={t("common.language")}
      >
        {uiLanguages.map((code) => (
          <option key={code} value={code}>
            {getLanguage(code)?.nativeName ?? code}
          </option>
        ))}
      </select>
    </label>
  );
}
