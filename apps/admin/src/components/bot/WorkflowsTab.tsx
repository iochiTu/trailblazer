"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { ApiError, api, type BotDetail, type Workflow } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Match the API limits (WORKFLOW_LIMITS in @traiblazer/industry-packs). */
const LIMITS = {
  maxWorkflows: 20,
  maxSteps: 10,
  nameLength: 80,
  whenLength: 300,
  stepLength: 300,
  finishLength: 300,
  guidelinesLength: 4000,
};

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

type LibraryFilter = "all" | "industry" | "common";

const newId = () => `custom-${crypto.randomUUID().slice(0, 8)}`;

/** Steps are edited as one line each; blank lines are kept while typing and dropped on save. */
type Draft = Omit<Workflow, "steps"> & { stepsText: string };

const toDraft = (w: Workflow): Draft => {
  const { steps, ...rest } = w;
  return { ...rest, stepsText: steps.join("\n") };
};

const fromDraft = ({ stepsText, ...rest }: Draft): Workflow => ({
  ...rest,
  name: rest.name.trim(),
  when: rest.when.trim(),
  finish: rest.finish.trim(),
  steps: stepsText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, LIMITS.maxSteps),
});

/**
 * How the assistant responds and its workflows. Both start as a copy of the industry template and
 * belong to the business: edit them, turn workflows off, delete them or write new ones.
 */
export function WorkflowsTab({
  detail,
  base,
  onChange,
}: {
  detail: BotDetail;
  base: string;
  onChange: () => Promise<void>;
}) {
  const { t } = useI18n();
  const template = detail.defaults;
  const industryName = detail.pack?.name ?? detail.bot.pack;
  const [guidelines, setGuidelines] = useState(detail.behavior.guidelines);
  const [drafts, setDrafts] = useState<Draft[]>(() => detail.behavior.workflows.map(toDraft));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [query, setQuery] = useState("");

  const usedTemplates = new Set(drafts.map((d) => d.template).filter(Boolean));
  const needle = query.trim().toLowerCase();
  const library = template.library.filter(
    (w) =>
      (libraryFilter === "all" || w.group === libraryFilter) &&
      (!needle || `${w.name} ${w.when}`.toLowerCase().includes(needle)),
  );
  const atLimit = drafts.length >= LIMITS.maxWorkflows;

  const update = (index: number, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  const move = (index: number, by: -1 | 1) =>
    setDrafts((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });

  const addBlank = () =>
    setDrafts((list) => [
      ...list,
      { id: newId(), name: t("workflows.newName"), enabled: true, when: "", stepsText: "", finish: "" },
    ]);

  const addSuggested = (templateKey: string) => {
    const w = template.library.find((x) => x.template === templateKey);
    if (!w) return;
    // Keep ids unique even if the owner already wrote a workflow with the template's id.
    const { group: _group, ...workflow } = w;
    const id = drafts.some((d) => d.id === w.id) ? newId() : w.id;
    setDrafts((list) => [...list, toDraft({ ...workflow, id })]);
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api(base, {
        method: "PATCH",
        body: { guidelines: guidelines.trim(), workflows: drafts.map(fromDraft) },
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
      <Section
        title={t("workflows.guidelines")}
        hint={t("workflows.guidelinesHint", { template: industryName })}
      >
        <textarea
          className="input"
          rows={6}
          maxLength={LIMITS.guidelinesLength}
          value={guidelines}
          onChange={(e) => setGuidelines(e.target.value)}
          dir="auto"
        />
        {guidelines.trim() !== template.guidelines && (
          <div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setGuidelines(template.guidelines)}
            >
              {t("workflows.restoreGuidelines")}
            </button>
          </div>
        )}
      </Section>

      <Section title={t("workflows.title")} hint={t("workflows.hint")}>
        {drafts.length === 0 && <p className="muted text-sm">{t("workflows.empty")}</p>}

        <ol className="flex flex-col gap-4">
          {drafts.map((d, i) => (
            <li
              key={d.id}
              className={`panel flex flex-col gap-3 p-4 sm:p-5 ${d.enabled ? "" : "opacity-60"}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={d.enabled}
                    onChange={(e) => update(i, { enabled: e.target.checked })}
                  />
                  {t("workflows.enabled")}
                </label>
                <input
                  className="input min-w-0 flex-1 font-medium"
                  aria-label={t("workflows.name")}
                  required
                  maxLength={LIMITS.nameLength}
                  value={d.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  dir="auto"
                />
                {d.template && <span className="muted text-xs">{t("workflows.fromTemplate")}</span>}
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="btn btn-ghost px-2"
                    aria-label={t("workflows.moveUp")}
                    title={t("workflows.moveUp")}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost px-2"
                    aria-label={t("workflows.moveDown")}
                    title={t("workflows.moveDown")}
                    disabled={i === drafts.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setDrafts((list) => list.filter((_, j) => j !== i))}
                  >
                    {t("workflows.remove")}
                  </button>
                </div>
              </div>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{t("workflows.when")}</span>
                <input
                  className="input"
                  required
                  maxLength={LIMITS.whenLength}
                  value={d.when}
                  onChange={(e) => update(i, { when: e.target.value })}
                  dir="auto"
                />
                <span className="muted text-xs">{t("workflows.whenHint")}</span>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{t("workflows.steps")}</span>
                <textarea
                  className="input"
                  required
                  rows={Math.min(Math.max(d.stepsText.split("\n").length, 3), LIMITS.maxSteps)}
                  value={d.stepsText}
                  onChange={(e) => update(i, { stepsText: e.target.value })}
                  dir="auto"
                />
                <span className="muted text-xs">{t("workflows.stepsHint", { max: LIMITS.maxSteps })}</span>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{t("workflows.finish")}</span>
                <input
                  className="input"
                  maxLength={LIMITS.finishLength}
                  value={d.finish}
                  onChange={(e) => update(i, { finish: e.target.value })}
                  dir="auto"
                />
                <span className="muted text-xs">{t("workflows.finishHint")}</span>
              </label>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-ghost" onClick={addBlank} disabled={atLimit}>
            + {t("workflows.add")}
          </button>
          {atLimit && (
            <span className="muted text-xs">{t("workflows.limit", { max: LIMITS.maxWorkflows })}</span>
          )}
        </div>
      </Section>

      <Section title={t("workflows.library")} hint={t("workflows.libraryHint")}>
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "industry", "common"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className="chip"
              data-selected={libraryFilter === f}
              aria-pressed={libraryFilter === f}
              onClick={() => setLibraryFilter(f)}
            >
              {f === "all"
                ? t("workflows.filter.all")
                : f === "industry"
                  ? t("workflows.filter.industry", { template: industryName })
                  : t("workflows.filter.common")}
            </button>
          ))}
          <input
            className="input ml-auto max-w-xs"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("workflows.search")}
            aria-label={t("workflows.search")}
          />
        </div>

        {library.length === 0 ? (
          <p className="muted text-sm">{t("workflows.libraryEmpty")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {library.map((w) => {
              const added = usedTemplates.has(w.template);
              return (
                <li key={w.id} className="panel flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="font-medium">{w.name}</h4>
                    <button
                      type="button"
                      className={added ? "btn btn-ghost shrink-0" : "btn shrink-0"}
                      disabled={added || atLimit}
                      onClick={() => addSuggested(w.template!)}
                    >
                      {added ? `✓ ${t("workflows.libraryAdded")}` : `+ ${t("workflows.libraryAdd")}`}
                    </button>
                  </div>
                  <p className="muted text-sm">{w.when}</p>
                  <details className="text-sm">
                    <summary className="muted cursor-pointer text-xs">
                      {t("workflows.librarySteps", { count: w.steps.length })}
                    </summary>
                    <ol className="mt-2 list-decimal space-y-1 pl-5">
                      {w.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    {w.finish && <p className="muted mt-2 text-xs">{w.finish}</p>}
                  </details>
                </li>
              );
            })}
          </ul>
        )}
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
