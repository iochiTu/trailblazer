"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api, type KnowledgePhoto } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const MAX_SIDE = 1600;
const MAX_BYTES = 2 * 1024 * 1024;

/** Scales a photo down to at most 1600 px and returns JPEG base64 (also drops camera metadata). */
async function toUploadable(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const quality of [0.85, 0.7, 0.5]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
      if (blob && blob.size <= MAX_BYTES) {
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        return url.replace(/^data:[^,]*,/, "");
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Business photos the assistant can show visitors (Knowledge tab). */
export function PhotosSection({ base }: { base: string }) {
  const { t } = useI18n();
  const [photos, setPhotos] = useState<KnowledgePhoto[] | null>(null);
  const [limit, setLimit] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const data = await api<{ images: KnowledgePhoto[]; limit: number }>(`${base}/images`);
    setPhotos(data.images);
    setLimit(data.limit);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    setError(null);
    if (!(file instanceof File) || !file.size) return;
    setSaving(true);
    try {
      const encoded = await toUploadable(file);
      if (!encoded) {
        setError(t("photos.unreadable"));
        return;
      }
      await api(`${base}/images`, {
        method: "POST",
        body: { title: data.get("title"), description: data.get("description"), data: encoded },
      });
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function update(id: string, body: Partial<Pick<KnowledgePhoto, "enabled">>) {
    await api(`${base}/images/${id}`, { method: "PATCH", body });
    await load();
  }

  async function remove(id: string) {
    await api(`${base}/images/${id}`, { method: "DELETE" });
    await load();
  }

  const full = photos !== null && photos.length >= limit;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="font-medium">{t("photos.title")}</h3>
        <p className="muted text-sm">{t("photos.hint")}</p>
      </div>
      {photos === null ? (
        <p className="muted text-sm">{t("common.loading")}</p>
      ) : photos.length === 0 ? (
        <p className="muted text-sm">{t("photos.empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {photos.map((p) => (
            <li key={p.id} className="card flex gap-3 p-3">
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                {/* biome-ignore lint/performance/noImgElement: public asset served by the API */}
                <img src={p.url} alt={p.title} className="h-20 w-20 rounded-md object-cover" />
              </a>
              <div className="flex min-w-0 flex-1 flex-col gap-1" dir="auto">
                <div className="truncate font-medium">{p.title}</div>
                <div className="muted line-clamp-3 text-sm">{p.description}</div>
                <div className="mt-auto flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) => void update(p.id, { enabled: e.target.checked })}
                    />
                    {t("photos.enabled")}
                  </label>
                  <button type="button" className="btn btn-ghost py-1" onClick={() => void remove(p.id)}>
                    {t("common.delete")}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {photos !== null && (
        <p className="muted text-xs">
          {t("photos.count", { count: photos.length, limit })} · {t("photos.public")}
        </p>
      )}
      {full ? (
        <p className="muted text-sm">{t("photos.limit")}</p>
      ) : (
        <form className="card grid gap-2 p-4 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end" onSubmit={add}>
          <label className="flex flex-col gap-1 text-sm">
            {t("photos.file")}
            <input
              className="input"
              name="file"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/*"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("photos.photoTitle")}
            <input className="input" name="title" required maxLength={120} dir="auto" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("photos.description")}
            <input
              className="input"
              name="description"
              required
              minLength={3}
              maxLength={1000}
              dir="auto"
              placeholder={t("photos.descriptionPlaceholder")}
            />
          </label>
          <button className="btn" type="submit" disabled={saving}>
            {t("photos.add")}
          </button>
        </form>
      )}
      {error && (
        <p className="error text-sm" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
