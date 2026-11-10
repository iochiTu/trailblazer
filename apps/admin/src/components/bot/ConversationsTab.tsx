"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Conversation, type ConversationMessage, type MessageAttachment } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** A visitor's image: its name, and the picture on request (staff only, never public). */
function Attachment({ src, attachment }: { src: string; attachment: MessageAttachment }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  return (
    <span className="mb-1 block whitespace-normal">
      <button
        type="button"
        className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--surface-3)] px-2.5 py-0.5 text-xs hover:bg-[var(--accent-soft)]"
        aria-expanded={shown}
        aria-label={
          shown ? t("conversations.hideImage") : t("conversations.viewImage", { name: attachment.name })
        }
        onClick={() => setShown((v) => !v)}
      >
        <span aria-hidden="true">📎</span>
        <span className="truncate">{attachment.name}</span>
      </button>
      {shown && (
        <span className="mt-2 block">
          <a href={src} target="_blank" rel="noopener noreferrer" title={t("conversations.openImage")}>
            {/* biome-ignore lint/performance/noImgElement: private, authenticated image from the API */}
            <img
              src={src}
              alt={attachment.name}
              className="max-h-60 max-w-full rounded-md border border-[var(--border)]"
            />
          </a>
        </span>
      )}
    </span>
  );
}

export function ConversationsTab({ base, openId }: { base: string; openId?: string | null }) {
  const { t, language } = useI18n();
  const [list, setList] = useState<Conversation[] | null>(null);
  const [open, setOpen] = useState<{ id: string; messages: ConversationMessage[] } | null>(null);

  useEffect(() => {
    void api<{ conversations: Conversation[] }>(`${base}/conversations`).then((d) =>
      setList(d.conversations),
    );
  }, [base]);

  const show = useCallback(
    async (id: string) => {
      const data = await api<{ messages: ConversationMessage[] }>(`${base}/conversations/${id}`);
      setOpen({ id, messages: data.messages });
    },
    [base],
  );

  // Opened from elsewhere (e.g. a request's "View conversation"), even if it isn't in the recent list.
  useEffect(() => {
    if (openId) void show(openId).catch(() => {});
  }, [openId, show]);

  if (list === null) return <p className="muted text-sm">{t("common.loading")}</p>;
  if (!list.length) return <p className="muted text-sm">{t("conversations.empty")}</p>;

  const fmt = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <ul className="flex flex-col gap-1">
        {list.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              aria-current={open?.id === c.id || undefined}
              className={`w-full rounded-2xl px-3 py-2.5 text-start text-sm ${open?.id === c.id ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-soft-text)]" : "hover:bg-[var(--surface-2)]"}`}
              onClick={() => show(c.id)}
            >
              {fmt.format(new Date(c.lastMessageAt))}
              <span className="muted block text-xs">
                {c.channel} · {c.language ?? "?"} · {t("conversations.messages", { count: c.messageCount })}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <div className="flex flex-col gap-2">
          {open.messages.map((m) => (
            <div
              key={m.id}
              dir="auto"
              className={`max-w-[85%] rounded-[20px] px-4 py-3 text-sm whitespace-pre-wrap ${m.role === "user" ? "self-end rounded-ee-md bg-[var(--accent-soft)] text-[var(--accent-soft-text)]" : "self-start rounded-es-md bg-[var(--surface-2)]"}`}
            >
              {m.attachments?.map((a) => (
                <Attachment
                  key={a.id}
                  attachment={a}
                  src={`/api${base}/conversations/${open.id}/attachments/${a.id}`}
                />
              ))}
              {m.content}
              {m.images && m.images.length > 0 && (
                <span className="mt-2 flex flex-wrap gap-2">
                  {m.images.map((image) => (
                    <a key={image.id} href={image.url} target="_blank" rel="noopener noreferrer">
                      {/* biome-ignore lint/performance/noImgElement: public asset served by the API */}
                      <img
                        src={image.url}
                        alt={image.title}
                        className="h-24 rounded-md border border-[var(--border)]"
                      />
                    </a>
                  ))}
                </span>
              )}
              {m.model && (
                <span className="muted mt-1 block text-xs" dir="ltr">
                  {m.model}
                  {m.costMicros ? ` · $${(m.costMicros / 1_000_000).toFixed(4)}` : ""}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
