"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api, type KnowledgeGap } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/**
 * Questions visitors asked that the assistant couldn't answer from the business's information,
 * most asked first. Answering one adds a Q&A answer; "Not relevant" takes it off the list.
 * Hidden when there is nothing to answer.
 */
export function GapsSection({
  base,
  onAnswered,
  onCount,
}: {
  base: string;
  /** A Q&A answer was added: the rest of the tab reloads. */
  onAnswered: () => Promise<void>;
  /** Reports how many questions are waiting (shown on the tab). */
  onCount?: (open: number) => void;
}) {
  const { t, language } = useI18n();
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [answering, setAnswering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api<{ gaps: KnowledgeGap[]; openCount: number }>(`${base}/gaps`);
    setGaps(data.gaps);
    onCount?.(data.openCount);
  }, [base, onCount]);

  useEffect(() => {
    void load().catch(() => {});
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      setAnswering(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  function answer(event: FormEvent<HTMLFormElement>, gap: KnowledgeGap) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(async () => {
      await api(`${base}/gaps/${gap.id}/answer`, {
        method: "POST",
        body: { question: data.get("question"), answer: data.get("answer") },
      });
      await onAnswered();
    });
  }

  const dismiss = (gap: KnowledgeGap) =>
    run(() => api(`${base}/gaps/${gap.id}`, { method: "PATCH", body: { status: "dismissed" } }));

  if (!gaps.length) return null;
  const fmt = new Intl.DateTimeFormat(language, { dateStyle: "medium" });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-lg font-semibold">{t("gaps.title")}</h3>
        <p className="muted text-sm">{t("gaps.hint")}</p>
      </div>
      {error && (
        <p className="error text-sm" role="alert">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {gaps.map((gap) => (
          <li key={gap.id} className="panel flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold" dir="auto">
                {gap.topic}
              </span>
              <span className={gap.occurrences > 1 ? "badge badge-accent" : "badge"}>
                {t("gaps.asked", { count: gap.occurrences })}
              </span>
              <span className="muted ms-auto text-xs">
                {t("gaps.last", { date: fmt.format(new Date(gap.lastAskedAt)) })}
              </span>
            </div>
            <p className="muted text-sm" dir="auto">
              “{gap.question}”
            </p>

            {answering === gap.id ? (
              <form className="flex flex-col gap-3" onSubmit={(e) => answer(e, gap)}>
                <label className="flex flex-col gap-1 text-sm">
                  {t("qa.question")}
                  <input
                    className="input"
                    name="question"
                    required
                    minLength={3}
                    maxLength={500}
                    defaultValue={gap.question}
                    dir="auto"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("qa.answer")}
                  <textarea className="input" name="answer" required maxLength={4000} rows={3} dir="auto" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button className="btn" type="submit">
                    {t("gaps.save")}
                  </button>
                  <button className="btn btn-ghost" type="button" onClick={() => setAnswering(null)}>
                    {t("common.cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn" onClick={() => setAnswering(gap.id)}>
                  {t("gaps.answer")}
                </button>
                <button type="button" className="btn-text text-sm" onClick={() => dismiss(gap)}>
                  {t("gaps.dismiss")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
