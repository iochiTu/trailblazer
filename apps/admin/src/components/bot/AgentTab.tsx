"use client";

import type { MessageKey } from "@traiblazer/i18n";
import { useEffect, useState } from "react";
import { type ChatBubble, ChatThread } from "@/components/chat/ChatThread";
import { ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/**
 * "Update by chat": the onboarding chat's look, with an agent behind it. The owner says what
 * changed ("we're open Saturdays now", "parking is behind the building") and the agent updates the
 * hours, details, interview answers, common answers and notices itself, then says what it changed.
 *
 * The conversation is kept in this browser (per assistant) and sent with each message; the server
 * keeps none of it.
 */

type Area = "business" | "interview" | "answers" | "notices";

interface AgentReply {
  reply: string;
  changes: { area: Area | string; summary: string }[];
}

interface Turn extends ChatBubble {
  /** The greeting and errors aren't part of what the agent reads. */
  local?: boolean;
}

/** Most messages sent back to the agent (the server takes up to 30). */
const HISTORY = 24;
const MAX_MESSAGE = 4000;
const storageKey = (base: string) => `tb.agent.${base}`;

const AREA_DONE: Record<Area, MessageKey> = {
  business: "agent.done.business",
  interview: "agent.done.interview",
  answers: "agent.done.answers",
  notices: "agent.done.notices",
};

const SUGGESTIONS: MessageKey[] = [
  "agent.suggest.hours",
  "agent.suggest.closure",
  "agent.suggest.interview",
  "agent.suggest.answer",
];

function readTurns(base: string): Turn[] | null {
  try {
    const raw = window.localStorage.getItem(storageKey(base));
    return raw ? (JSON.parse(raw) as Turn[]) : null;
  } catch {
    return null;
  }
}

function writeTurns(base: string, turns: Turn[] | null) {
  try {
    if (turns) window.localStorage.setItem(storageKey(base), JSON.stringify(turns.slice(-HISTORY * 2)));
    else window.localStorage.removeItem(storageKey(base));
  } catch {
    // Private window or storage blocked: the chat still works, it just isn't kept.
  }
}

export function AgentTab({ base, onChange }: { base: string; onChange: () => void }) {
  const { t, language } = useI18n();
  const greeting = (): Turn => ({ from: "bot", text: t("agent.hello"), local: true });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: once per assistant
  useEffect(() => {
    setTurns(readTurns(base) ?? [greeting()]);
  }, [base]);

  const save = (next: Turn[]) => {
    setTurns(next);
    writeTurns(base, next);
  };

  async function send(message: string) {
    const value = message.trim().slice(0, MAX_MESSAGE);
    if (!value || busy) return;
    const asked: Turn[] = [...turns, { from: "me", text: value }];
    save(asked);
    setText("");
    setBusy(true);
    setProblem(null);
    try {
      const history = asked
        .filter((turn) => !turn.local)
        .slice(-HISTORY)
        .map((turn) => ({
          role: turn.from === "me" ? "user" : "assistant",
          text: turn.text.slice(0, MAX_MESSAGE),
        }));
      const result = await api<AgentReply>(`${base}/agent`, {
        method: "POST",
        body: { messages: history, language },
      });
      const areas = [...new Set(result.changes.map((c) => c.area))];
      save([
        ...asked,
        {
          from: "bot",
          text: result.reply || t("agent.noReply"),
          done: areas.map((area) => (area in AREA_DONE ? t(AREA_DONE[area as Area]) : area)),
        },
      ]);
      if (result.changes.length) onChange();
    } catch (err) {
      // The message wasn't answered: back in the box, to send again.
      save(turns);
      setText(value);
      setProblem(
        err instanceof ApiError && err.code === "agent_unavailable"
          ? t("agent.unavailable")
          : err instanceof ApiError && err.status < 500
            ? err.message
            : t("agent.error"),
      );
    } finally {
      setBusy(false);
    }
  }

  const fresh = !turns.some((turn) => turn.from === "me");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="muted max-w-prose text-sm">{t("agent.intro")}</p>
        {!fresh && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => {
              save([greeting()]);
              setProblem(null);
            }}
          >
            {t("agent.restart")}
          </button>
        )}
      </div>
      <div className="flex min-h-[420px] flex-col rounded-[20px] border border-[var(--border)] p-4 sm:p-5">
        <ChatThread
          label={t("agent.chatLabel")}
          messages={turns}
          busy={busy}
          busyText={t("agent.working")}
          problem={problem}
          chips={fresh ? SUGGESTIONS.map((key) => ({ label: t(key), onClick: () => void send(t(key)) })) : []}
          composer={{
            id: "agent-message",
            value: text,
            onChange: setText,
            onSubmit: () => void send(text),
            label: t("agent.message"),
            sendLabel: t("welcome.send"),
            placeholder: t("agent.placeholder"),
            maxLength: MAX_MESSAGE,
          }}
        />
      </div>
    </div>
  );
}
