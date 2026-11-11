"use client";

import { getLanguage, type MessageKey } from "@traiblazer/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api, type BotDetail, type DayKey, type SetupRun, type SetupSuggestion } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  draftFromProfile,
  draftToProfile,
  hoursToDraft,
  type ProfileDraft,
  type ProfileField,
} from "@/lib/profile";
import { ProfileFields } from "./BusinessDetails";

/** The details the setup assistant looks for; links and the time zone stay on the General tab. */
const DETAIL_FIELDS = [
  "businessName",
  "phone",
  "email",
  "websiteUrl",
  "address",
] as const satisfies ProfileField[];
const FAILURES = ["no_information", "unreadable_reply", "model_unavailable", "timed_out"];
const unfinished = (run: SetupRun | null) => run?.status === "pending" || run?.status === "running";

/**
 * The setup assistant on the Knowledge tab: reads what the business added and suggests its
 * details, opening hours, page description, services and products, greeting and suggested questions. The owner edits the suggestion and
 * applies it; nothing is used before that.
 */
export function SetupSection({
  detail,
  base,
  sourcesReady,
  onApplied,
}: {
  detail: BotDetail;
  base: string;
  /** Changes when the sources do, so "is there anything to read?" is asked again. */
  sourcesReady: number;
  /** The suggestion was applied: the assistant and its Q&A answers reload. */
  onApplied: () => Promise<void>;
}) {
  const { t, language } = useI18n();
  const [state, setState] = useState<{ run: SetupRun | null; pages: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloads when the sources change
  const load = useCallback(async () => {
    setState(await api<{ run: SetupRun | null; pages: number }>(`${base}/setup`));
  }, [base, sourcesReady]);

  useEffect(() => {
    void load().catch(() => {});
  }, [load]);

  // Poll while the information is being read.
  const waiting = unfinished(state?.run ?? null);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "setup_limit"
          ? t("setup.limit")
          : err instanceof ApiError
            ? err.message
            : t("common.error"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;
  const current = state.run;
  const start = () => run(() => api(`${base}/setup`, { method: "POST" }));

  return (
    <section className="panel flex flex-col gap-3 p-4 sm:p-5">
      <div>
        <h3 className="text-lg font-semibold">{t("setup.title")}</h3>
        <p className="muted text-sm">{t("setup.intro")}</p>
      </div>

      {waiting ? (
        <p className="text-sm" role="status">
          {t("setup.reading")}
        </p>
      ) : current?.status === "ready" && current.suggestion ? (
        <Review
          key={current.id}
          detail={detail}
          suggestion={current.suggestion}
          busy={busy}
          onApply={(body) =>
            run(async () => {
              await api(`${base}/setup/${current.id}/apply`, { method: "POST", body });
              await onApplied();
            })
          }
          onDiscard={() => run(() => api(`${base}/setup/${current.id}`, { method: "DELETE" }))}
        />
      ) : (
        <>
          {current?.status === "failed" && (
            <p className="error text-sm" role="alert">
              {t(
                `setup.failed.${FAILURES.includes(current.error ?? "") ? current.error : "model_unavailable"}` as MessageKey,
              )}
            </p>
          )}
          {current?.status === "applied" && (
            <p className="muted text-sm">
              {t("setup.applied", {
                date: new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(
                  new Date(current.updatedAt),
                ),
              })}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={current ? "btn btn-ghost" : "btn"}
              disabled={busy || state.pages === 0}
              onClick={start}
            >
              {current ? t("setup.again") : t("setup.start")}
            </button>
            {state.pages === 0 && <span className="muted text-sm">{t("setup.needInfo")}</span>}
          </div>
        </>
      )}

      {error && (
        <p className="error text-sm" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** The suggestion as an editable form: the owner keeps, changes or drops each part. */
function Review({
  detail,
  suggestion,
  busy,
  onApply,
  onDiscard,
}: {
  detail: BotDetail;
  suggestion: SetupSuggestion;
  busy: boolean;
  onApply: (body: unknown) => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { bot } = detail;
  const found = [
    ...DETAIL_FIELDS.filter((field) => suggestion.profile[field]),
    ...(suggestion.profile.hours ? (["hours"] as const) : []),
  ];
  // What was found, over what the assistant already has.
  const [draft, setDraft] = useState<ProfileDraft>(() => {
    const saved = draftFromProfile(detail.profile);
    return {
      ...saved,
      ...Object.fromEntries(
        DETAIL_FIELDS.flatMap((f) => (suggestion.profile[f] ? [[f, suggestion.profile[f]]] : [])),
      ),
      hours: suggestion.profile.hours ? hoursToDraft(suggestion.profile.hours) : saved.hours,
    };
  });
  const [invalidDay, setInvalidDay] = useState<DayKey | null>(null);
  const greetingCodes = bot.languages.filter((code) => suggestion.greeting[code]);
  const questionCodes = bot.languages.filter((code) => suggestion.quickReplies[code]?.length);
  const [use, setUse] = useState({ details: true, page: true, greeting: true, quickReplies: true });
  // Each proposed service or product, editable, with a tick for the ones to add to the page.
  const [services, setServices] = useState(() =>
    (suggestion.services ?? []).map((item) => ({
      ...item,
      description: item.description ?? "",
      priceText: item.priceText ?? "",
      keep: true,
    })),
  );
  const editService = (index: number, change: Partial<(typeof services)[number]>) =>
    setServices((list) => list.map((item, i) => (i === index ? { ...item, ...change } : item)));
  const hasPage = Boolean(suggestion.profile.description) || services.length > 0;
  const toggle = (part: keyof typeof use) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={use[part]}
        onChange={(e) => setUse({ ...use, [part]: e.target.checked })}
      />
      {t("setup.use")}
    </label>
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};

    if (use.details) {
      const result = draftToProfile(draft);
      setInvalidDay(result.invalidDay ?? null);
      if (result.invalidDay) return;
      // Only the details shown here; links and the time zone are left as they are.
      const { bookingUrl: _b, orderingUrl: _o, timezone: _t, ...profile } = result.profile;
      body.profile = profile;
    }
    if (use.page) {
      const description = String(data.get("description") ?? "").trim();
      if (description) body.profile = { ...(body.profile as object | undefined), description };
      const kept = services
        .filter((item) => item.keep && item.name.trim())
        .map(({ kind, name, description: about, priceText, category }) => ({
          kind,
          name: name.trim(),
          description: about.trim() || null,
          priceText: priceText.trim() || null,
          category: category ?? null,
        }));
      if (kept.length) body.services = kept;
    }
    if (use.greeting) {
      body.greeting = Object.fromEntries(
        greetingCodes
          .map((code) => [code, String(data.get(`greeting.${code}`) ?? "").trim()])
          .filter(([, text]) => text),
      );
    }
    if (use.quickReplies) {
      body.quickReplies = Object.fromEntries(
        questionCodes
          .map((code) => [
            code,
            String(data.get(`quickReplies.${code}`) ?? "")
              .split("\n")
              .map((line) => line.trim().slice(0, 120))
              .filter(Boolean)
              .slice(0, 6),
          ])
          .filter(([, lines]) => lines.length),
      );
    }
    body.answers = suggestion.missing
      .map((question, index) => ({ question, answer: String(data.get(`answer.${index}`) ?? "").trim() }))
      .filter((pair) => pair.answer);
    void onApply(body);
  }

  const languageLabel = (code: string) => getLanguage(code)?.nativeName ?? code;

  return (
    <form className="flex flex-col gap-6" onSubmit={onSubmit}>
      <p className="muted text-sm">
        {suggestion.basic
          ? t("setup.basic")
          : t("setup.read", { read: suggestion.pagesRead, total: suggestion.pagesTotal })}
      </p>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-semibold">{t("profile.title")}</legend>
        <span className="muted text-sm">
          {found.length ? t("setup.detailsHint") : t("setup.nothingFound")}
        </span>
        {toggle("details")}
        {use.details && (
          <ProfileFields
            draft={draft}
            onChange={setDraft}
            fields={[...DETAIL_FIELDS]}
            found={found}
            evidence={suggestion.evidence}
            invalidDay={invalidDay}
          />
        )}
      </fieldset>

      {hasPage && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-semibold">{t("setup.page")}</legend>
          {toggle("page")}
          {use.page && suggestion.profile.description && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("page.description")}</span>
              <textarea
                className="input"
                name="description"
                rows={2}
                maxLength={300}
                dir="auto"
                defaultValue={suggestion.profile.description}
              />
              <span className="muted text-xs">{t("page.descriptionHint")}</span>
            </label>
          )}
          {use.page && services.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t("setup.services")}</span>
              <span className="muted text-sm">{t("setup.servicesHint")}</span>
              <ul className="flex flex-col divide-y divide-[var(--border)]">
                {services.map((item, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the list is never reordered
                  <li key={index} className="flex items-start gap-3 py-3">
                    <input
                      type="checkbox"
                      className="mt-2.5"
                      checked={item.keep}
                      aria-label={t("setup.serviceKeep", { name: item.name })}
                      onChange={(e) => editService(index, { keep: e.target.checked })}
                    />
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[2fr_1fr]">
                      <input
                        className="input"
                        aria-label={t("catalog.name")}
                        maxLength={120}
                        dir="auto"
                        disabled={!item.keep}
                        value={item.name}
                        onChange={(e) => editService(index, { name: e.target.value })}
                      />
                      <input
                        className="input"
                        aria-label={t("catalog.price")}
                        placeholder={t("catalog.price")}
                        maxLength={60}
                        dir="auto"
                        disabled={!item.keep}
                        value={item.priceText}
                        onChange={(e) => editService(index, { priceText: e.target.value })}
                      />
                      <input
                        className="input sm:col-span-2"
                        aria-label={t("catalog.description")}
                        placeholder={t("catalog.description")}
                        maxLength={500}
                        dir="auto"
                        disabled={!item.keep}
                        value={item.description}
                        onChange={(e) => editService(index, { description: e.target.value })}
                      />
                      <span className="muted text-xs sm:col-span-2" dir="auto">
                        {[t(`catalog.kind.${item.kind}`), item.category].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </fieldset>
      )}

      {greetingCodes.length > 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-semibold">{t("general.greeting")}</legend>
          {toggle("greeting")}
          {use.greeting &&
            greetingCodes.map((code) => (
              <label key={code} className="flex flex-col gap-1 text-sm">
                <span>{languageLabel(code)}</span>
                <textarea
                  className="input"
                  name={`greeting.${code}`}
                  rows={2}
                  maxLength={300}
                  dir={getLanguage(code)?.dir ?? "auto"}
                  defaultValue={suggestion.greeting[code]}
                />
              </label>
            ))}
        </fieldset>
      )}

      {questionCodes.length > 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-semibold">{t("general.quickReplies")}</legend>
          <span className="muted text-sm">{t("setup.quickRepliesHint")}</span>
          {toggle("quickReplies")}
          {use.quickReplies &&
            questionCodes.map((code) => (
              <label key={code} className="flex flex-col gap-1 text-sm">
                <span>{languageLabel(code)}</span>
                <textarea
                  className="input"
                  name={`quickReplies.${code}`}
                  rows={4}
                  dir={getLanguage(code)?.dir ?? "auto"}
                  defaultValue={suggestion.quickReplies[code]!.join("\n")}
                />
              </label>
            ))}
        </fieldset>
      )}

      {suggestion.missing.length > 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-semibold">{t("setup.missing")}</legend>
          <span className="muted text-sm">{t("setup.missingHint")}</span>
          {suggestion.missing.map((question, index) => (
            <label key={question} className="flex flex-col gap-1 text-sm">
              <span className="font-medium" dir="auto">
                {question}
              </span>
              <textarea
                className="input"
                name={`answer.${index}`}
                rows={2}
                maxLength={4000}
                dir="auto"
                placeholder={t("setup.answerPlaceholder")}
              />
            </label>
          ))}
        </fieldset>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" type="submit" disabled={busy}>
          {t("setup.apply")}
        </button>
        <button className="btn-text text-sm" type="button" disabled={busy} onClick={() => void onDiscard()}>
          {t("setup.discard")}
        </button>
      </div>
    </form>
  );
}
