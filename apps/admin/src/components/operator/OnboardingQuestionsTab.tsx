"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { OperatorQuestion, OperatorQuestionPack } from "@/lib/operator";

const KINDS = [
  { id: "short", label: "Short answer" },
  { id: "long", label: "Long answer (one line per item)" },
  { id: "choice", label: "Quick answers to tap" },
] as const;

const base = "/v1/operator/onboarding-questions";

/** Quick answers as written in the form: one per line, "English | Français". */
const optionsText = (options: OperatorQuestion["options"]) =>
  options.map((o) => `${o.en} | ${o.fr}`).join("\n");

function readForm(form: HTMLFormElement) {
  const data = new FormData(form);
  const text = (k: string) => String(data.get(k) ?? "").trim();
  const kind = text("kind") as OperatorQuestion["kind"];
  return {
    ...(data.has("key") ? { key: text("key") } : {}),
    kind,
    question: { en: text("questionEn"), fr: text("questionFr") },
    hint: { en: text("hintEn"), fr: text("hintFr") },
    options:
      kind === "choice"
        ? text("options")
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const [en = "", fr = ""] = line.split("|").map((part) => part.trim());
              return { en, fr };
            })
        : [],
    packs: data.getAll("packs").map(String),
  };
}

function QuestionFields({
  question,
  packs,
  isNew,
}: {
  question?: OperatorQuestion;
  packs: OperatorQuestionPack[];
  isNew?: boolean;
}) {
  const [kind, setKind] = useState<OperatorQuestion["kind"]>(question?.kind ?? "short");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {isNew && (
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium">Key</span>
          <input
            className="input max-w-xs"
            name="key"
            required
            pattern="[a-z][a-z0-9_]{1,39}"
            title="Lowercase letters, digits and _, starting with a letter"
            placeholder="e.g. delivery_area"
          />
          <span className="muted text-xs">Permanent: businesses' answers are stored under it.</span>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Question (English)</span>
        <textarea
          className="input"
          name="questionEn"
          rows={2}
          required
          maxLength={300}
          defaultValue={question?.question.en}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Question (French)</span>
        <textarea
          className="input"
          name="questionFr"
          rows={2}
          required
          maxLength={300}
          defaultValue={question?.question.fr}
          lang="fr"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Hint (English)</span>
        <textarea className="input" name="hintEn" rows={2} maxLength={300} defaultValue={question?.hint.en} />
        <span className="muted text-xs">An example of the kind of answer, never a fact. Optional.</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Hint (French)</span>
        <textarea
          className="input"
          name="hintFr"
          rows={2}
          maxLength={300}
          defaultValue={question?.hint.fr}
          lang="fr"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Answer</span>
        <select
          className="input"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as OperatorQuestion["kind"])}
        >
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {kind === "choice" && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Quick answers</span>
          <textarea
            className="input"
            name="options"
            rows={4}
            required
            defaultValue={question ? optionsText(question.options) : ""}
            placeholder={"Pets welcome | Animaux bienvenus\nNo pets | Pas d'animaux"}
          />
          <span className="muted text-xs">
            One per line: English | French. Owners can still write their own answer.
          </span>
        </label>
      )}
      <fieldset className="flex flex-col gap-2 sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">Asked of</legend>
        <p className="muted -mt-1 text-xs">Leave every box empty to ask every industry.</p>
        <div className="flex flex-wrap gap-2">
          {packs.map((pack) => (
            <label key={pack.slug} className="chip" title={`Phase ${pack.phase}`}>
              <input
                type="checkbox"
                name="packs"
                value={pack.slug}
                defaultChecked={question?.packs.includes(pack.slug) ?? false}
              />
              <span>
                {pack.name}
                {pack.phase > 1 && <span className="muted"> · phase {pack.phase}</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/**
 * The setup interview's question set (operator console): what the onboarding chat and the
 * Knowledge tab's interview ask each business, by industry. English-only staff UI; the questions
 * themselves are written in English and French.
 */
export function OnboardingQuestionsTab() {
  const [questions, setQuestions] = useState<OperatorQuestion[] | null>(null);
  const [packs, setPacks] = useState<OperatorQuestionPack[]>([]);
  const [industry, setIndustry] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const data = await api<{ questions: OperatorQuestion[]; packs: OperatorQuestionPack[] }>(base);
    setQuestions(data.questions);
    setPacks(data.packs);
  }, []);

  useEffect(() => {
    void load().catch(() => setMessage({ kind: "error", text: "Couldn't load the questions." }));
  }, [load]);

  async function run<T>(action: () => Promise<T>, ok: string | ((result: T) => string)) {
    setMessage(null);
    setBusy(true);
    try {
      const result = await action();
      setMessage({ kind: "ok", text: typeof ok === "string" ? ok : ok(result) });
      await load();
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Couldn't save." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const packName = useMemo(() => new Map(packs.map((p) => [p.slug, p.name])), [packs]);
  const shown = useMemo(
    () =>
      (questions ?? []).filter(
        (q) => !industry || ((q.packs.length === 0 || q.packs.includes(industry)) && q.enabled),
      ),
    [questions, industry],
  );

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = readForm(event.currentTarget);
    if (await run(() => api(base, { method: "POST", body }), `Question "${body.key}" added at the end.`)) {
      setAdding(false);
    }
  }

  async function onSave(event: FormEvent<HTMLFormElement>, question: OperatorQuestion) {
    event.preventDefault();
    const body = readForm(event.currentTarget);
    if (
      await run(() => api(`${base}/${question.id}`, { method: "PATCH", body }), `"${question.key}" saved.`)
    ) {
      setEditing(null);
    }
  }

  const move = (question: OperatorQuestion, by: -1 | 1) => {
    const ids = (questions ?? []).map((q) => q.id);
    const from = ids.indexOf(question.id);
    const to = from + by;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    void run(() => api(`${base}/order`, { method: "POST", body: { ids } }), `"${question.key}" moved.`);
  };

  if (!questions) {
    return message ? (
      <p className="error" role="alert">
        {message.text}
      </p>
    ) : (
      <p className="muted">Loading…</p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium">Onboarding questions</h2>
          <p className="muted text-sm">
            What the onboarding chat asks a new business, and what its Knowledge tab interview shows later.
            Each business gets the questions for every industry, then those for its own, in this order.
            Answers become the assistant's knowledge, word for word. Changes apply to the next business that
            answers; answers already saved stay until the owner edits them.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Show</span>
            <select className="input" value={industry} onChange={(e) => setIndustry(e.target.value)}>
              <option value="">The whole set</option>
              {packs.map((p) => (
                <option key={p.slug} value={p.slug}>
                  As asked of: {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn"
            type="button"
            onClick={() => {
              setAdding(true);
              setEditing(null);
            }}
            disabled={adding}
          >
            Add a question
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(
                () => api<{ restored: string[] }>(`${base}/restore`, { method: "POST" }),
                ({ restored }) =>
                  restored.length
                    ? `Added back at their standard place: ${restored.join(", ")}.`
                    : "Every standard question is already in the set.",
              )
            }
          >
            Add back removed standard questions
          </button>
        </div>
        {message && (
          <p
            className={message.kind === "error" ? "error text-sm" : "text-sm"}
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        )}
      </div>

      {adding && (
        <form className="card flex flex-col gap-4 p-5" onSubmit={onCreate}>
          <h3 className="font-medium">New question</h3>
          <QuestionFields packs={packs} isNew />
          <div className="flex flex-wrap gap-2">
            <button className="btn" type="submit" disabled={busy}>
              Add question
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {industry && (
        <p className="muted text-sm">
          {shown.length} questions, in the order the chat asks them. Turned-off questions are hidden here.
        </p>
      )}

      <ol className="flex flex-col gap-3">
        {shown.map((q, index) => (
          <li key={q.id} className={`panel flex flex-col gap-3 p-4 ${q.enabled ? "" : "opacity-70"}`}>
            {editing === q.id ? (
              <form className="flex flex-col gap-4" onSubmit={(e) => onSave(e, q)}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <code className="text-sm">{q.key}</code>
                  <span className="muted text-xs">The key can't be changed.</span>
                </div>
                <QuestionFields question={q} packs={packs} />
                <div className="flex flex-wrap gap-2">
                  <button className="btn" type="submit" disabled={busy}>
                    Save
                  </button>
                  <button className="btn btn-ghost" type="button" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="muted w-6 text-sm tabular-nums">{index + 1}.</span>
                  <code className="text-sm">{q.key}</code>
                  <span className="badge">
                    {q.packs.length === 0
                      ? "Every industry"
                      : q.packs.map((s) => packName.get(s) ?? s).join(", ")}
                  </span>
                  {q.kind !== "short" && (
                    <span className="badge">{q.kind === "long" ? "Long answer" : "Quick answers"}</span>
                  )}
                  {!q.enabled && <span className="badge">Off</span>}
                  {!q.standard && <span className="badge badge-accent">Added by staff</span>}
                  {q.modified && <span className="badge badge-accent">Changed from standard</span>}
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <p className="font-medium">{q.question.en}</p>
                    {q.hint.en && <p className="muted text-xs">{q.hint.en}</p>}
                  </div>
                  <div lang="fr">
                    <p className="font-medium">{q.question.fr}</p>
                    {q.hint.fr && <p className="muted text-xs">{q.hint.fr}</p>}
                  </div>
                </div>
                {q.kind === "choice" && (
                  <ul className="flex flex-wrap gap-2 text-xs" aria-label="Quick answers">
                    {q.options.map((o) => (
                      <li key={o.en} className="chip">
                        {o.en} / <span lang="fr">{o.fr}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  {!industry && (
                    <>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        aria-label={`Move ${q.key} up`}
                        disabled={busy || index === 0}
                        onClick={() => move(q, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        aria-label={`Move ${q.key} down`}
                        disabled={busy || index === shown.length - 1}
                        onClick={() => move(q, 1)}
                      >
                        ↓
                      </button>
                    </>
                  )}
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => {
                      setEditing(q.id);
                      setAdding(false);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => api(`${base}/${q.id}`, { method: "PATCH", body: { enabled: !q.enabled } }),
                        q.enabled ? `"${q.key}" turned off.` : `"${q.key}" turned on.`,
                      )
                    }
                  >
                    {q.enabled ? "Turn off" : "Turn on"}
                  </button>
                  {q.modified && (
                    <button
                      className="btn btn-ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Put "${q.key}" back to the standard wording and industries?`))
                          return;
                        void run(() => api(`${base}/${q.id}/reset`, { method: "POST" }), `"${q.key}" reset.`);
                      }}
                    >
                      Reset to standard
                    </button>
                  )}
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Delete "${q.key}"? New businesses won't be asked it. To stop asking it for now, turn it off instead.`,
                        )
                      )
                        return;
                      void run(() => api(`${base}/${q.id}`, { method: "DELETE" }), `"${q.key}" deleted.`);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
