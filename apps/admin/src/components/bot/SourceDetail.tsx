"use client";

import { type FormEvent, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const MAX_TEXT = 50_000;

interface SourceWithContent {
  id: string;
  type: "website" | "text" | "file";
  title: string;
  url: string | null;
  content: string | null;
  fileName: string | null;
  updatedAt: string;
}

/**
 * Opened under a source in the Knowledge tab. Pasted text can be read and edited (saving
 * re-indexes it in the background); for websites it lists the pages that were read; for an
 * uploaded file it shows the text that was read from it.
 */
export function SourceDetail({
  url,
  onSaved,
  onClose,
}: {
  url: string;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState<SourceWithContent | null>(null);
  const [pages, setPages] = useState<{ title: string | null; url: string | null }[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ source: SourceWithContent; pages: { title: string | null; url: string | null }[] }>(url)
      .then((data) => {
        setSource(data.source);
        setPages(data.pages);
        setTitle(data.source.title);
        setContent(data.source.content ?? "");
      })
      .catch(() => setError(t("common.error")));
  }, [url, t]);

  if (!source) {
    return <p className="muted py-2 text-sm">{error ?? t("common.loading")}</p>;
  }

  const changed = title.trim() !== source.title || content.trim() !== (source.content ?? "").trim();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(url, { method: "PATCH", body: { title: title.trim(), content: content.trim() } });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  if (source.type === "file") {
    return (
      <div className="flex flex-col gap-2 panel p-4">
        <span className="text-sm font-medium">
          {t("knowledge.fileText", { name: source.fileName ?? source.title })}
        </span>
        {source.content ? (
          <>
            <pre
              className="input max-h-80 overflow-y-auto whitespace-pre-wrap font-[inherit] text-sm"
              dir="auto"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard
              tabIndex={0}
            >
              {source.content}
            </pre>
            <span className="muted text-xs">{t("knowledge.fileTextHint")}</span>
          </>
        ) : (
          <span className="muted text-sm">{t("knowledge.fileNoText")}</span>
        )}
        <div>
          <button type="button" className="btn btn-ghost py-1" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    );
  }

  if (source.type === "website") {
    return (
      <div className="flex flex-col gap-2 panel p-4">
        <span className="text-sm font-medium">{t("knowledge.pagesRead")}</span>
        {pages.length === 0 ? (
          <span className="muted text-sm">{t("knowledge.noPages")}</span>
        ) : (
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
            {pages.map((p) => (
              <li key={p.url ?? p.title} className="min-w-0">
                <a
                  href={p.url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-4 hover:underline"
                >
                  {p.title ?? p.url}
                </a>
                <span className="muted block truncate text-xs" dir="ltr">
                  {p.url}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div>
          <button type="button" className="btn btn-ghost py-1" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-2 panel p-4" onSubmit={save}>
      <label className="flex flex-col gap-1 text-sm">
        {t("knowledge.textTitle")}
        <input
          className="input"
          value={title}
          required
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          dir="auto"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("knowledge.textContent")}
        <textarea
          className="input font-[inherit]"
          value={content}
          required
          rows={Math.min(18, Math.max(6, content.split("\n").length + 1))}
          maxLength={MAX_TEXT}
          onChange={(e) => setContent(e.target.value)}
          dir="auto"
        />
      </label>
      <div className="muted flex flex-wrap justify-between gap-2 text-xs">
        <span>{t("knowledge.editHint")}</span>
        <span>
          {t("knowledge.characters", { count: content.length, max: MAX_TEXT })} ·{" "}
          {t("knowledge.lastUpdated", { date: new Date(source.updatedAt) })}
        </span>
      </div>
      {error && (
        <p className="error text-sm" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn" type="submit" disabled={busy || !changed || !content.trim() || !title.trim()}>
          {busy ? t("common.loading") : t("common.save")}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
