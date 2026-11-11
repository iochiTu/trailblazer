"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api, type BotDetail, type QaPair, type Source } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { GapsSection } from "./GapsSection";
import { InterviewSection } from "./InterviewSection";
import { PhotosSection, toUploadable } from "./PhotosSection";
import { SetupSection } from "./SetupSection";
import { SourceDetail } from "./SourceDetail";

/** Uploaded price lists and brochures: the largest file, and what the file picker offers. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FILE_ACCEPT = ".pdf,.docx,application/pdf,image/png,image/jpeg,image/webp";

/** A file's content as base64 (no `data:` prefix). */
const toBase64 = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const statusColor: Record<Source["status"], string> = {
  pending: "var(--muted)",
  processing: "var(--accent)",
  ready: "var(--accent)",
  failed: "var(--danger)",
};

export function KnowledgeTab({
  detail,
  base,
  onChange,
  onGapCount,
}: {
  detail: BotDetail;
  base: string;
  /** Reloads the assistant after the setup assistant's suggestion is applied. */
  onChange: () => Promise<void>;
  onGapCount?: (open: number) => void;
}) {
  const { t } = useI18n();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [pairs, setPairs] = useState<QaPair[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [interviewOpen, setInterviewOpen] = useState(false);

  const load = useCallback(async () => {
    const [s, q] = await Promise.all([
      api<{ sources: Source[] }>(`${base}/sources`),
      api<{ pairs: QaPair[] }>(`${base}/qa`),
    ]);
    setSources(s.sources);
    setPairs(q.pairs);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while a source is being read.
  useEffect(() => {
    if (!sources?.some((s) => s.status === "pending" || s.status === "processing")) return;
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  }, [sources, load]);

  async function submit(event: FormEvent<HTMLFormElement>, body: (data: FormData) => unknown, path: string) {
    event.preventDefault();
    const form = event.currentTarget;
    setError(null);
    try {
      await api(path, { method: "POST", body: body(new FormData(form)) });
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  /** Uploads a price list or brochure; a photo is scaled down first, like other photos. */
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || !file.size) return;
    setError(null);
    setUploading(true);
    try {
      const photo = file.type.startsWith("image/");
      if (!photo && file.size > MAX_FILE_BYTES) {
        setError(t("knowledge.fileTooBig"));
        return;
      }
      const content = photo ? await toUploadable(file) : await toBase64(file);
      if (!content) {
        setError(t("knowledge.fileUnreadable"));
        return;
      }
      const title = String(data.get("title") ?? "").trim();
      await api(`${base}/sources/file`, {
        method: "POST",
        body: { name: file.name, data: content, ...(title ? { title } : {}) },
      });
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setUploading(false);
    }
  }

  async function action(path: string, method: "POST" | "DELETE") {
    await api(path, { method });
    await load();
  }

  return (
    <div className="flex flex-col gap-6">
      <GapsSection base={base} onAnswered={load} onCount={onGapCount} />
      <SetupSection
        detail={detail}
        base={base}
        sourcesReady={sources?.reduce((n, s) => n + (s.status === "ready" ? s.documentCount : 0), 0) ?? 0}
        onApplied={async () => {
          await Promise.all([onChange(), load()]);
        }}
      />
      <InterviewSection base={base} open={interviewOpen} onOpenChange={setInterviewOpen} onSaved={load} />
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-lg font-semibold">{t("knowledge.sources")}</h3>
          <p className="muted text-sm">{t("knowledge.sourcesHint")}</p>
        </div>
        {sources === null ? (
          <p className="muted text-sm">{t("common.loading")}</p>
        ) : sources.length === 0 ? (
          <p className="muted text-sm">{t("knowledge.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{s.interview ? t("knowledge.type.interview") : s.title}</div>
                    <div className="muted truncate text-xs" dir="ltr">
                      {s.url ??
                        (s.interview
                          ? t("knowledge.type.text")
                          : s.type === "file"
                            ? [t("knowledge.type.file"), s.fileName].filter(Boolean).join(" · ")
                            : t("knowledge.type.text"))}
                    </div>
                    {s.error && <div className="error text-xs">{s.error}</div>}
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span style={{ color: statusColor[s.status] }}>{t(`knowledge.status.${s.status}`)}</span>
                    {s.status === "ready" && (
                      <span className="muted">{t("knowledge.pages", { count: s.documentCount })}</span>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost py-1"
                      aria-expanded={s.interview ? interviewOpen : openId === s.id}
                      onClick={() => {
                        if (!s.interview) {
                          setOpenId((id) => (id === s.id ? null : s.id));
                          return;
                        }
                        setInterviewOpen(true);
                        document.getElementById("interview")?.scrollIntoView({ behavior: "smooth" });
                      }}
                    >
                      {s.interview
                        ? t("knowledge.editAnswers")
                        : s.type === "text"
                          ? t("knowledge.viewEdit")
                          : s.type === "file"
                            ? t("knowledge.viewText")
                            : t("knowledge.view")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost py-1"
                      onClick={() => action(`${base}/sources/${s.id}/sync`, "POST")}
                    >
                      {t("knowledge.resync")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost py-1"
                      onClick={() => action(`${base}/sources/${s.id}`, "DELETE")}
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                </div>
                {openId === s.id && (
                  <SourceDetail
                    url={`${base}/sources/${s.id}`}
                    onSaved={load}
                    onClose={() => setOpenId(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <form
            className="panel flex flex-col gap-3 p-4 sm:p-5"
            onSubmit={(e) =>
              submit(
                e,
                (d) => ({
                  type: "website",
                  url: d.get("url"),
                  maxPages: Number(d.get("maxPages")) || undefined,
                }),
                `${base}/sources`,
              )
            }
          >
            <h4 className="font-medium">{t("knowledge.addWebsite")}</h4>
            <label className="flex flex-col gap-1 text-sm">
              {t("knowledge.websiteUrl")}
              <input
                className="input"
                name="url"
                type="url"
                required
                placeholder="https://www.example.com"
                dir="ltr"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("knowledge.maxPages")}
              <input
                className="input w-28"
                name="maxPages"
                type="number"
                min={1}
                max={500}
                defaultValue={50}
              />
            </label>
            <div>
              <button className="btn" type="submit">
                {t("knowledge.add")}
              </button>
            </div>
          </form>

          <form
            className="panel flex flex-col gap-3 p-4 sm:p-5"
            onSubmit={(e) =>
              submit(
                e,
                (d) => ({ type: "text", title: d.get("title"), content: d.get("content") }),
                `${base}/sources`,
              )
            }
          >
            <h4 className="font-medium">{t("knowledge.addText")}</h4>
            <label className="flex flex-col gap-1 text-sm">
              {t("knowledge.textTitle")}
              <input className="input" name="title" required maxLength={200} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("knowledge.textContent")}
              <textarea className="input" name="content" required rows={4} maxLength={50000} />
            </label>
            <div>
              <button className="btn" type="submit">
                {t("knowledge.add")}
              </button>
            </div>
          </form>

          <form className="panel flex flex-col gap-3 p-4 sm:p-5 md:col-span-2" onSubmit={upload}>
            <div>
              <h4 className="font-medium">{t("knowledge.addFile")}</h4>
              <p className="muted text-sm">{t("knowledge.fileHint")}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                {t("knowledge.file")}
                <input className="input" name="file" type="file" required accept={FILE_ACCEPT} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("knowledge.fileTitle")}
                <input className="input" name="title" maxLength={200} dir="auto" />
              </label>
            </div>
            <div>
              <button className="btn" type="submit" disabled={uploading}>
                {uploading ? t("knowledge.uploading") : t("knowledge.upload")}
              </button>
            </div>
          </form>
        </div>
        {error && (
          <p className="error text-sm" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-lg font-semibold">{t("qa.title")}</h3>
          <p className="muted text-sm">{t("qa.hint")}</p>
        </div>
        {pairs.length === 0 ? (
          <p className="muted text-sm">{t("qa.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {pairs.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 py-2">
                <div dir="auto">
                  <div className="font-medium">{p.question}</div>
                  <div className="muted text-sm">{p.answer}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost py-1"
                  onClick={() => action(`${base}/qa/${p.id}`, "DELETE")}
                >
                  {t("common.delete")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="panel grid gap-3 p-4 sm:p-5 md:grid-cols-[1fr_2fr_auto] md:items-end"
          onSubmit={(e) =>
            submit(e, (d) => ({ question: d.get("question"), answer: d.get("answer") }), `${base}/qa`)
          }
        >
          <label className="flex flex-col gap-1 text-sm">
            {t("qa.question")}
            <input className="input" name="question" required minLength={3} maxLength={500} dir="auto" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("qa.answer")}
            <input className="input" name="answer" required maxLength={4000} dir="auto" />
          </label>
          <button className="btn" type="submit">
            {t("knowledge.add")}
          </button>
        </form>
      </section>

      <PhotosSection base={base} />
    </div>
  );
}
