"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api, type Interview } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/**
 * Interview mode of the setup assistant (Knowledge tab): questions for a business without a
 * website. The answers are saved as one knowledge source, which the setup assistant then reads.
 */
export function InterviewSection({
  base,
  open,
  onOpenChange,
  onSaved,
}: {
  base: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The answers were saved: the sources (and the setup assistant's "anything to read?") reload. */
  onSaved: () => Promise<void>;
}) {
  const { t, language } = useI18n();
  const lang = language.startsWith("fr") ? "fr" : "en";
  const [interview, setInterview] = useState<Interview | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setInterview(await api<Interview>(`${base}/interview`));
  }, [base]);

  useEffect(() => {
    void load().catch(() => setError(t("common.error")));
  }, [load, t]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!interview) return;
    const data = new FormData(event.currentTarget);
    const answers = Object.fromEntries(
      interview.questions.map((question) => [question.key, String(data.get(question.key) ?? "").trim()]),
    );
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/interview`, { method: "PUT", body: { answers } });
      await Promise.all([load(), onSaved()]);
      setSaved(true);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  if (!interview) return null;
  const answered = Object.keys(interview.answers).length;

  return (
    <section id="interview" className="panel flex flex-col gap-3 p-4 sm:p-5">
      <div>
        <h3 className="text-lg font-semibold">{t("interview.title")}</h3>
        <p className="muted text-sm">{t("interview.intro")}</p>
      </div>

      {open ? (
        <form className="flex flex-col gap-4" onSubmit={save}>
          {interview.questions.map((question) => (
            <label key={question.key} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{question.question[lang]}</span>
              <textarea
                className="input"
                name={question.key}
                rows={question.long ? 6 : 2}
                maxLength={2000}
                dir="auto"
                defaultValue={interview.answers[question.key] ?? ""}
              />
              <span className="muted text-xs">{question.hint[lang]}</span>
            </label>
          ))}
          {error && (
            <p className="error text-sm" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? t("common.loading") : t("interview.save")}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <>
          {saved && (
            <p className="text-sm" role="status">
              {t("interview.saved")} {t("interview.next")}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={answered ? "btn btn-ghost" : "btn"}
              onClick={() => {
                setSaved(false);
                onOpenChange(true);
              }}
            >
              {answered ? t("interview.edit") : t("interview.start")}
            </button>
            {answered > 0 && (
              <span className="muted text-sm">{t("interview.answered", { count: answered })}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
