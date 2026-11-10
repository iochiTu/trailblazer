"use client";

import type { MessageKey } from "@traiblazer/i18n";
import { type FormEvent, useMemo, useState } from "react";
import { ApiError, api, type BotDetail, type BusinessProfile, type DayKey } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { DAYS, draftFromProfile, draftToProfile, type ProfileDraft, type ProfileField } from "@/lib/profile";

const FIELDS: { field: ProfileField; type: string; dir?: "ltr" | "auto"; maxLength: number }[] = [
  { field: "businessName", type: "text", dir: "auto", maxLength: 200 },
  { field: "phone", type: "tel", dir: "ltr", maxLength: 40 },
  { field: "email", type: "email", dir: "ltr", maxLength: 254 },
  { field: "websiteUrl", type: "url", dir: "ltr", maxLength: 2048 },
  { field: "address", type: "text", dir: "auto", maxLength: 200 },
  { field: "bookingUrl", type: "url", dir: "ltr", maxLength: 2048 },
  { field: "orderingUrl", type: "url", dir: "ltr", maxLength: 2048 },
];

/** Monday 1 January 2024: the start of a week to name the days from. */
const dayName = (language: string, index: number) =>
  new Intl.DateTimeFormat(language, { weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, 0, 1 + index)),
  );

/**
 * The business details as form fields: contact details, address and opening hours (one line per
 * day). Used by the General tab and by the setup assistant's review, which shows fewer fields and
 * marks the ones it found.
 */
export function ProfileFields({
  draft,
  onChange,
  fields = FIELDS.map((f) => f.field),
  found = [],
  evidence = {},
  invalidDay,
}: {
  draft: ProfileDraft;
  onChange: (draft: ProfileDraft) => void;
  /** Which text fields to show (default: all). */
  fields?: ProfileField[];
  /** Fields (and "hours") the setup assistant filled in from the business's pages. */
  found?: (ProfileField | "hours")[];
  /** The business's own words a suggestion was read from. */
  evidence?: { hours?: string; address?: string };
  invalidDay?: DayKey | null;
}) {
  const { t, language } = useI18n();
  const foundBadge = (field: ProfileField | "hours") =>
    found.includes(field) && <span className="badge badge-accent ms-2">{t("setup.found")}</span>;
  const quote = (text: string | undefined) =>
    text && (
      <span className="muted text-xs" dir="auto">
        {t("setup.evidence")} “{text}”
      </span>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.filter((f) => fields.includes(f.field)).map(({ field, type, dir, maxLength }) => (
          <label
            key={field}
            className={`flex flex-col gap-1 text-sm ${field === "address" ? "sm:col-span-2" : ""}`}
          >
            <span className="font-medium">
              {t(`profile.${field}` as MessageKey)}
              {foundBadge(field)}
            </span>
            <input
              className="input"
              type={type}
              dir={dir}
              maxLength={maxLength}
              value={draft[field]}
              onChange={(e) => onChange({ ...draft, [field]: e.target.value })}
            />
            {field === "address" && quote(evidence.address)}
          </label>
        ))}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">
          {t("profile.hours")}
          {foundBadge("hours")}
        </legend>
        <span className="muted text-xs">{t("profile.hoursHint")}</span>
        {quote(evidence.hours)}
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {DAYS.map((day, index) => (
            <label key={day} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0">{dayName(language, index)}</span>
              <input
                className="input"
                dir="ltr"
                maxLength={80}
                placeholder={t("profile.closed")}
                aria-invalid={invalidDay === day}
                value={draft.hours[day]}
                onChange={(e) => onChange({ ...draft, hours: { ...draft.hours, [day]: e.target.value } })}
              />
            </label>
          ))}
        </div>
        {invalidDay && (
          <span className="error text-sm" role="alert">
            {t("profile.hoursInvalid", { day: dayName(language, DAYS.indexOf(invalidDay)) })}
          </span>
        )}
      </fieldset>
    </div>
  );
}

/** Business details on the General tab: what the assistant tells visitors about reaching the business. */
export function BusinessDetails({
  detail,
  base,
  onChange,
}: {
  detail: BotDetail;
  base: string;
  onChange: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => draftFromProfile(detail.profile));
  const [invalidDay, setInvalidDay] = useState<DayKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timezones = useMemo(() => {
    const all = Intl.supportedValuesOf("timeZone");
    return all.includes(draft.timezone) ? all : [draft.timezone, ...all];
  }, [draft.timezone]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = draftToProfile(draft);
    setInvalidDay(result.invalidDay ?? null);
    if (result.invalidDay) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const { profile } = await api<{ profile: BusinessProfile }>(`${base}/profile`, {
        method: "PUT",
        body: result.profile,
      });
      // Show the details as they were saved (times in full, e.g. "9-17" as "09:00-17:00").
      setDraft(draftFromProfile(profile));
      await onChange();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues[0]?.message ?? err.message) : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex max-w-3xl flex-col gap-4" onSubmit={onSubmit}>
      <div>
        <h3 className="text-lg font-semibold">{t("profile.title")}</h3>
        <p className="muted text-sm">{t("profile.hint")}</p>
      </div>
      <ProfileFields draft={draft} onChange={setDraft} invalidDay={invalidDay} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("profile.timezone")}</span>
        <select
          className="input max-w-xs"
          dir="ltr"
          value={draft.timezone}
          onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
        >
          {timezones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <span className="muted text-xs">{t("profile.timezoneHint")}</span>
      </label>
      <div className="flex items-center gap-3">
        <button className="btn" type="submit" disabled={busy}>
          {t("profile.save")}
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
