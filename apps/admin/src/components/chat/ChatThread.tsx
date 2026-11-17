"use client";

import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import { BrandMark } from "@/components/BrandMark";

/**
 * A conversation with Traiblazer in the portal: the onboarding chat (/welcome) and the agent chat
 * on an assistant's page. Messages, then quick replies (chips), then the answer box. What the
 * conversation does is up to the parent; this only shows it.
 */

export interface ChatBubble {
  from: "bot" | "me";
  text: string;
  /** Smaller text under a bot message (a question's hint). */
  note?: string;
  /** Things done, listed under a bot message ("Opening hours updated"). */
  done?: string[];
  /** A skipped question. */
  skipped?: boolean;
}

export interface ChatChip {
  label: string;
  onClick: () => void;
}

export interface ChatComposer {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  label: string;
  sendLabel: string;
  placeholder?: string;
  /** Several lines: Enter starts a new line, Ctrl/Cmd+Enter sends. */
  long?: boolean;
  maxLength: number;
  autoComplete?: string;
  inputMode?: "url" | "text";
  /** Shown above the box (e.g. "Question 2 of 8"). */
  above?: ReactNode;
  /** Shown under the box. */
  below?: ReactNode;
}

export function ChatThread({
  label,
  messages,
  busy,
  busyText,
  problem,
  chips = [],
  composer,
  footer,
}: {
  label: string;
  messages: ChatBubble[];
  busy: boolean;
  busyText: string;
  problem: string | null;
  chips?: ChatChip[];
  /** The answer box; none when the conversation doesn't take typing now. */
  composer?: ChatComposer | null;
  /** Shown instead of the chips and the answer box (e.g. when the conversation is over). */
  footer?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Each new message: show it, and give the answer box the focus back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a message is added
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    if (!busy) inputRef.current?.focus();
  }, [messages.length, busy]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy || !composer?.value.trim()) return;
    composer.onSubmit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div role="log" aria-live="polite" aria-label={label} className="flex flex-col gap-3">
        {messages.map((message, i) =>
          message.from === "bot" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: messages are only ever appended
            <div key={i} className="flex items-start gap-2">
              <span className="mt-1 shrink-0" aria-hidden="true">
                <BrandMark size={24} />
              </span>
              <div className="panel max-w-[85%] px-4 py-3 text-sm">
                <p className="whitespace-pre-line" dir="auto">
                  {message.text}
                </p>
                {message.note && <p className="muted mt-1 text-xs">{message.note}</p>}
                {message.done && message.done.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1 border-t border-[var(--border)] pt-2 text-xs">
                    {message.done.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span aria-hidden="true">✓</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
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
          <div className="flex items-start gap-2" role="status">
            <span className="mt-1 shrink-0" aria-hidden="true">
              <BrandMark size={24} />
            </span>
            <p className="flex items-center gap-3 px-1 py-3 text-sm">
              <span className="chat-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              {/* A new key for each new status, so it slides in again. */}
              <span key={busyText} className="chat-status">
                {busyText}
              </span>
            </p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {problem && (
        <p className="error text-sm" role="alert">
          {problem}
        </p>
      )}

      {footer ?? (
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
          {composer && (
            <form className="flex flex-col gap-1" onSubmit={submit}>
              {composer.above}
              <div className="flex items-end gap-2">
                <label className="sr-only" htmlFor={composer.id}>
                  {composer.label}
                </label>
                {composer.long ? (
                  <textarea
                    id={composer.id}
                    ref={inputRef}
                    className="input flex-1"
                    rows={5}
                    dir="auto"
                    maxLength={composer.maxLength}
                    value={composer.value}
                    placeholder={composer.placeholder}
                    onChange={(e) => composer.onChange(e.target.value)}
                    onKeyDown={onKeyDown}
                    disabled={busy}
                  />
                ) : (
                  <input
                    id={composer.id}
                    ref={inputRef}
                    className="input flex-1"
                    dir="auto"
                    maxLength={composer.maxLength}
                    value={composer.value}
                    placeholder={composer.placeholder}
                    autoComplete={composer.autoComplete ?? "off"}
                    inputMode={composer.inputMode}
                    onChange={(e) => composer.onChange(e.target.value)}
                    disabled={busy}
                  />
                )}
                <button className="btn" type="submit" disabled={busy || !composer.value.trim()}>
                  {composer.sendLabel}
                </button>
              </div>
              {composer.below}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
