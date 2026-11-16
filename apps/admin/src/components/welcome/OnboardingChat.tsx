"use client";

import { getIndustry } from "@traiblazer/marketing";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ApiError, api, type Interview, type InterviewQuestion, type Me, type Pack } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/**
 * The onboarding chat: a new owner's first setup, as a conversation. It asks the business's name,
 * its industry (picked, or recognized from the owner's words), the languages and the website, then
 * the setup interview's questions for that industry (staff keep the set in the operator console).
 * Every answer goes through the portal's usual routes, so the result is the same as setting up by
 * hand: a business, its assistant, the interview's knowledge source and the website being read.
 * Then the setup assistant is started to suggest the page and the services from it all.
 *
 * Progress is kept in this browser (per account) so the owner can finish later.
 */

type Step =
  | "name"
  | "industry"
  | "confirm"
  | "variant"
  | "languages"
  | "website"
  | "question"
  | "finishing"
  | "done";

interface Message {
  from: "bot" | "me";
  text: string;
  /** Smaller text under a bot message (a question's hint). */
  note?: string;
  /** A skipped question. */
  skipped?: boolean;
}

interface Draft {
  step: Step;
  messages: Message[];
  tenantId?: string;
  business?: string;
  pack?: string;
  variant?: string | null;
  guess?: { pack: string; variant: string | null };
  botId?: string;
  questions?: InterviewQuestion[];
  index: number;
  answers: Record<string, string>;
  /** The setup assistant was started (the closing message says so). */
  preparing?: boolean;
}

const EMPTY: Draft = { step: "name", messages: [], index: 0, answers: {} };
const MAX_ANSWER = 2000;
const draftKey = (userId: string) => `tb.welcome.${userId}`;

function readDraft(userId: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(userId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(userId: string, draft: Draft | null) {
  try {
    if (draft) window.localStorage.setItem(draftKey(userId), JSON.stringify(draft));
    else window.localStorage.removeItem(draftKey(userId));
  } catch {
    // Private window or storage blocked: the chat still works, it just can't be resumed.
  }
}

/** A web address as typed ("mybakery.ca") made into a full one, or null when it isn't one. */
export function normalizeWebsite(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

const bot = (text: string, note?: string): Message => ({ from: "bot", text, ...(note ? { note } : {}) });
const mine = (text: string, skipped = false): Message => ({
  from: "me",
  text,
  ...(skipped ? { skipped } : {}),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function OnboardingChat() {
  const { t, language } = useI18n();
  const lang = language.startsWith("fr") ? "fr" : "en";
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  // ---- Loading and saving progress ---------------------------------------------------------

  useEffect(() => {
    api<Me>("/v1/auth/me")
      .then((data) => {
        if (data.user.platformRole || data.user.demo) {
          router.replace("/dashboard");
          return;
        }
        setMe(data);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else setProblem(t("welcome.error"));
      });
    void api<{ available: Pack[] }>("/v1/catalog/packs").then((d) => setPacks(d.available));
  }, [router, t]);

  // Start, or pick up a conversation left in this browser (if its business is still this account's).
  // Once, when the account is loaded: switching the language doesn't restart the conversation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per page load
  useEffect(() => {
    if (!me || started.current) return;
    started.current = true;
    const saved = readDraft(me.user.id);
    if (
      saved &&
      saved.step !== "done" &&
      (!saved.tenantId || me.tenants.some((x) => x.id === saved.tenantId))
    ) {
      // Welcome back, then the question the owner left at again (so it's the last thing said).
      const current = saved.step === "question" && saved.questions?.[saved.index] ? saved : null;
      const resumed = {
        ...saved,
        messages: [
          ...saved.messages,
          bot(t("welcome.resume")),
          ...(current ? [askQuestion(current.questions!, current.index)] : []),
        ],
      };
      setDraft(resumed);
      // Left while the answers were being saved: save them again.
      if (saved.step === "finishing") void step(() => finish(resumed));
    } else {
      setDraft({ ...EMPTY, messages: [bot(t("welcome.hello", { name: me.user.name }))] });
    }
  }, [me]);

  const update = useCallback(
    (next: Draft) => {
      setDraft(next);
      if (me) writeDraft(me.user.id, next.step === "done" ? null : next);
    },
    [me],
  );

  // Each new message: show it, and give the answer box the focus back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a message is added
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    if (!busy) inputRef.current?.focus();
  }, [draft.messages.length, busy]);

  // ---- Words ---------------------------------------------------------------------------------

  const packName = (slug: string) =>
    slug === "generic"
      ? t("welcome.other")
      : (getIndustry(slug)?.name[lang] ?? packs.find((p) => p.slug === slug)?.name ?? slug);

  const variantName = (packSlug: string, variant: string) => {
    const pack = packs.find((p) => p.slug === packSlug);
    const index = pack?.variants.findIndex((v) => v.slug === variant) ?? -1;
    return getIndustry(packSlug)?.kinds[lang][index] ?? pack?.variants[index]?.name ?? variant;
  };

  const askQuestion = (questions: InterviewQuestion[], index: number): Message => {
    const question = questions[index]!;
    return bot(question.question[lang], question.hint[lang] || undefined);
  };

  /** Runs a step's work; a failure is said in the chat and the step stays, to try again. */
  async function step(work: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (err) {
      setProblem(err instanceof ApiError && err.status < 500 ? err.message : t("welcome.error"));
    } finally {
      setBusy(false);
    }
  }

  // ---- The conversation ------------------------------------------------------------------------

  const giveName = (name: string) =>
    step(async () => {
      const { tenant } = await api<{ tenant: { id: string } }>("/v1/tenants", {
        method: "POST",
        body: { name },
      });
      update({
        ...draft,
        step: "industry",
        tenantId: tenant.id,
        business: name,
        messages: [...draft.messages, mine(name), bot(t("welcome.industryAsk", { business: name }))],
      });
      setText("");
    });

  /** The industry is settled: ask for its type when it has some, else the languages. */
  const choosePack = (pack: string, variant: string | null, said: string, base = draft) => {
    const variants = packs.find((p) => p.slug === pack)?.variants ?? [];
    const askVariant = variant === null && variants.length > 0;
    update({
      ...base,
      step: askVariant ? "variant" : "languages",
      pack,
      variant,
      guess: undefined,
      messages: [
        ...base.messages,
        mine(said),
        bot(askVariant ? t("welcome.variantAsk") : t("welcome.languagesAsk")),
      ],
    });
  };

  const describeIndustry = (description: string) =>
    step(async () => {
      const found = await api<{ pack: string | null; variant: string | null }>(
        `/v1/tenants/${draft.tenantId}/onboarding/industry`,
        { method: "POST", body: { description } },
      );
      const messages = [...draft.messages, mine(description)];
      if (found.pack) {
        const industry = found.variant ? variantName(found.pack, found.variant) : packName(found.pack);
        update({
          ...draft,
          step: "confirm",
          guess: { pack: found.pack, variant: found.variant },
          messages: [...messages, bot(t("welcome.industryGuess", { industry }))],
        });
      } else {
        update({ ...draft, step: "industry", messages: [...messages, bot(t("welcome.industryUnsure"))] });
      }
      setText("");
    });

  const chooseLanguages = (languages: string[], said: string) =>
    step(async () => {
      const defaultLanguage = languages.includes(lang) ? lang : languages[0]!;
      const { bot: created } = await api<{ bot: { id: string } }>(`/v1/tenants/${draft.tenantId}/bots`, {
        method: "POST",
        body: {
          name: draft.business,
          pack: draft.pack,
          variant: draft.variant ?? null,
          languages,
          defaultLanguage,
        },
      });
      update({
        ...draft,
        step: "website",
        botId: created.id,
        messages: [...draft.messages, mine(said), bot(t("welcome.websiteAsk"))],
      });
    });

  /** The website is added (or there is none): on to the interview's questions. */
  const startQuestions = async (said: Message, extra: Message[]) => {
    const interview = await api<Interview>(`/v1/tenants/${draft.tenantId}/bots/${draft.botId}/interview`);
    const questions = interview.questions;
    const next: Draft = {
      ...draft,
      step: questions.length ? "question" : "finishing",
      questions,
      index: 0,
      answers: { ...interview.answers },
      messages: [
        ...draft.messages,
        said,
        ...extra,
        ...(questions.length
          ? [
              bot(t("welcome.questionsIntro", { count: questions.length, business: draft.business ?? "" })),
              askQuestion(questions, 0),
            ]
          : []),
      ],
    };
    update(next);
    setText("");
    if (!questions.length) await finish(next);
  };

  const giveWebsite = (typed: string) => {
    const url = normalizeWebsite(typed);
    if (!url) {
      setProblem(t("welcome.websiteInvalid"));
      return;
    }
    void step(async () => {
      await api(`/v1/tenants/${draft.tenantId}/bots/${draft.botId}/sources`, {
        method: "POST",
        body: { type: "website", url },
      });
      await startQuestions(mine(typed), [bot(t("welcome.websiteAdded", { site: new URL(url).hostname }))]);
    });
  };

  const answer = (value: string | null) => {
    const questions = draft.questions ?? [];
    const question = questions[draft.index];
    if (!question) return;
    const answers = { ...draft.answers };
    if (value) answers[question.key] = value.slice(0, MAX_ANSWER);
    else delete answers[question.key];
    const index = draft.index + 1;
    const last = index >= questions.length;
    const next: Draft = {
      ...draft,
      step: last ? "finishing" : "question",
      index,
      answers,
      messages: [
        ...draft.messages,
        value ? mine(value) : mine(t("welcome.skipped"), true),
        ...(last ? [] : [askQuestion(questions, index)]),
      ],
    };
    update(next);
    setText("");
    if (last) void step(() => finish(next));
  };

  /**
   * Saves the answers, then starts the setup assistant once the answers (or the website) can be
   * read: it suggests the page, the services and the greeting, which the owner reviews.
   */
  async function finish(current: Draft) {
    const base = `/v1/tenants/${current.tenantId}/bots/${current.botId}`;
    await api(`${base}/interview`, { method: "PUT", body: { answers: current.answers } });
    let preparing = false;
    try {
      for (let attempt = 0; attempt < 15 && !preparing; attempt++) {
        const { pages, run } = await api<{ pages: number; run: { status: string } | null }>(`${base}/setup`);
        if (run && (run.status === "pending" || run.status === "running")) preparing = true;
        else if (pages > 0) {
          await api(`${base}/setup`, { method: "POST" });
          preparing = true;
        } else await sleep(2000);
      }
    } catch {
      // The owner can start it from the assistant's page.
    }
    update({
      ...current,
      step: "done",
      preparing,
      messages: [...current.messages, bot(preparing ? t("welcome.preparing") : t("welcome.done"))],
    });
  }

  // ---- Input -----------------------------------------------------------------------------------

  const question = draft.step === "question" ? draft.questions?.[draft.index] : undefined;
  const long = question?.kind === "long";

  function onSubmit(event?: FormEvent) {
    event?.preventDefault();
    const value = text.trim();
    if (busy || !value) return;
    if (draft.step === "question") return answer(value);
    if (draft.step === "name") void giveName(value);
    else if (draft.step === "industry" || draft.step === "confirm" || draft.step === "variant")
      void describeIndustry(value);
    else if (draft.step === "website") giveWebsite(value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // In a long answer Enter starts a new line; Ctrl/Cmd+Enter sends.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) onSubmit();
  }

  const chips: { label: string; onClick: () => void }[] = (() => {
    switch (draft.step) {
      case "industry":
        return packs.map((p) => ({
          label: packName(p.slug),
          onClick: () => choosePack(p.slug, null, packName(p.slug)),
        }));
      case "confirm": {
        const guess = draft.guess!;
        return [
          { label: t("welcome.yes"), onClick: () => choosePack(guess.pack, guess.variant, t("welcome.yes")) },
          {
            label: t("welcome.pickAnother"),
            onClick: () =>
              update({
                ...draft,
                step: "industry",
                guess: undefined,
                messages: [
                  ...draft.messages,
                  mine(t("welcome.pickAnother")),
                  bot(t("welcome.industryUnsure")),
                ],
              }),
          },
        ];
      }
      case "variant": {
        const pack = packs.find((p) => p.slug === draft.pack);
        return [
          ...(pack?.variants ?? []).map((v) => ({
            label: variantName(pack!.slug, v.slug),
            onClick: () =>
              update({
                ...draft,
                step: "languages",
                variant: v.slug,
                messages: [
                  ...draft.messages,
                  mine(variantName(pack!.slug, v.slug)),
                  bot(t("welcome.languagesAsk")),
                ],
              }),
          })),
          {
            label: t("welcome.variantNone"),
            onClick: () =>
              update({
                ...draft,
                step: "languages",
                variant: null,
                messages: [...draft.messages, mine(t("welcome.variantNone")), bot(t("welcome.languagesAsk"))],
              }),
          },
        ];
      }
      case "languages": {
        const options: [string, string[]][] = [
          [t("welcome.languagesBoth"), lang === "fr" ? ["fr", "en"] : ["en", "fr"]],
          [t("welcome.languagesEn"), ["en"]],
          [t("welcome.languagesFr"), ["fr"]],
        ];
        return options.map(([label, languages]) => ({
          label,
          onClick: () => void chooseLanguages(languages, label),
        }));
      }
      case "website":
        return [
          {
            label: t("welcome.noWebsite"),
            onClick: () => void step(() => startQuestions(mine(t("welcome.noWebsite")), [])),
          },
        ];
      case "question":
        return [
          ...(question?.options ?? []).map((o) => ({ label: o[lang], onClick: () => answer(o[lang]) })),
          { label: t("welcome.skip"), onClick: () => answer(null) },
        ];
      default:
        return [];
    }
  })();

  const typing = ["name", "industry", "confirm", "variant", "website", "question"].includes(draft.step);
  const placeholder =
    draft.step === "name"
      ? t("welcome.namePlaceholder")
      : draft.step === "website"
        ? t("welcome.websitePlaceholder")
        : draft.step === "question"
          ? ""
          : t("welcome.industryPlaceholder");

  // ---- Page --------------------------------------------------------------------------------------

  if (!me) {
    return problem ? (
      <p className="error p-8" role="alert">
        {problem}
      </p>
    ) : (
      <p className="muted p-8">{t("common.loading")}</p>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-3 text-xl font-semibold">
          <BrandMark />
          {t("welcome.title")}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <LanguageSwitcher />
          {draft.step !== "done" && (
            <Link href="/dashboard" className="btn btn-ghost">
              {t("welcome.later")}
            </Link>
          )}
        </div>
      </header>
      <p className="muted text-sm">{t("welcome.intro")}</p>

      <section className="card flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <div
          role="log"
          aria-live="polite"
          aria-label={t("welcome.chatLabel")}
          className="flex flex-col gap-3"
        >
          {draft.messages.map((message, i) =>
            message.from === "bot" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: messages are only ever appended
              <div key={i} className="flex items-start gap-2">
                <span className="mt-1 shrink-0" aria-hidden="true">
                  <BrandMark size={24} />
                </span>
                <div className="panel max-w-[85%] px-4 py-3 text-sm">
                  <p className="whitespace-pre-line">{message.text}</p>
                  {message.note && <p className="muted mt-1 text-xs">{message.note}</p>}
                </div>
              </div>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: messages are only ever appended
              <div key={i} className="flex justify-end">
                <p
                  dir="auto"
                  className={`max-w-[85%] whitespace-pre-line rounded-[18px] px-4 py-3 text-sm ${
                    message.skipped
                      ? "muted border border-[var(--border)] italic"
                      : "bg-[var(--accent)] text-[var(--accent-text)]"
                  }`}
                >
                  {message.text}
                </p>
              </div>
            ),
          )}
          {busy && (
            <p className="muted ms-8 text-sm" role="status">
              {draft.step === "finishing" ? t("welcome.saving") : t("welcome.thinking")}
            </p>
          )}
          <div ref={endRef} />
        </div>

        {problem && (
          <p className="error text-sm" role="alert">
            {problem}
          </p>
        )}

        {draft.step === "done" ? (
          <div>
            <Link className="btn" href={`/t/${draft.tenantId}/bots/${draft.botId}?tab=knowledge`}>
              {t("welcome.open")}
            </Link>
          </div>
        ) : (
          <div className="mt-auto flex flex-col gap-3">
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {chips.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    className="chip"
                    disabled={busy}
                    onClick={chip.onClick}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}
            {typing && (
              <form className="flex flex-col gap-1" onSubmit={onSubmit}>
                {question && (
                  <span className="muted text-xs">
                    {t("welcome.progress", { current: draft.index + 1, total: draft.questions!.length })}
                  </span>
                )}
                <div className="flex items-end gap-2">
                  <label className="sr-only" htmlFor="welcome-answer">
                    {t("welcome.answer")}
                  </label>
                  {long ? (
                    <textarea
                      id="welcome-answer"
                      ref={inputRef}
                      className="input flex-1"
                      rows={5}
                      dir="auto"
                      maxLength={MAX_ANSWER}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={onKeyDown}
                      disabled={busy}
                    />
                  ) : (
                    <input
                      id="welcome-answer"
                      ref={inputRef}
                      className="input flex-1"
                      dir="auto"
                      maxLength={draft.step === "name" ? 120 : draft.step === "question" ? MAX_ANSWER : 300}
                      value={text}
                      placeholder={placeholder}
                      autoComplete={
                        draft.step === "name" ? "organization" : draft.step === "website" ? "url" : "off"
                      }
                      inputMode={draft.step === "website" ? "url" : undefined}
                      onChange={(e) => setText(e.target.value)}
                      disabled={busy}
                    />
                  )}
                  <button className="btn" type="submit" disabled={busy || !text.trim()}>
                    {t("welcome.send")}
                  </button>
                </div>
                {long && <span className="muted text-xs">{t("welcome.longNote")}</span>}
              </form>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
