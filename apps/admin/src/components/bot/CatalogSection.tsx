"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api, type CatalogItem } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { toUploadable } from "./PhotosSection";

type Draft = Pick<CatalogItem, "kind" | "name" | "description" | "priceText" | "category" | "action">;

const EMPTY: Draft = {
  kind: "service",
  name: "",
  description: "",
  priceText: "",
  category: "",
  action: "ask",
};

/** The fields of one service or product (adding and editing). */
function ItemFields({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const { t } = useI18n();
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("catalog.name")}</span>
        <input
          className="input"
          required
          maxLength={120}
          dir="auto"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("catalog.price")}</span>
        <input
          className="input"
          maxLength={60}
          dir="auto"
          placeholder={t("catalog.pricePlaceholder")}
          value={draft.priceText ?? ""}
          onChange={(e) => set({ priceText: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        <span className="font-medium">{t("catalog.description")}</span>
        <textarea
          className="input min-h-20"
          maxLength={500}
          dir="auto"
          value={draft.description ?? ""}
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("catalog.category")}</span>
        <input
          className="input"
          maxLength={60}
          dir="auto"
          placeholder={t("catalog.categoryPlaceholder")}
          value={draft.category ?? ""}
          onChange={(e) => set({ category: e.target.value })}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("catalog.kind")}</span>
          <select
            className="input"
            value={draft.kind}
            onChange={(e) => set({ kind: e.target.value as Draft["kind"] })}
          >
            <option value="service">{t("catalog.kind.service")}</option>
            <option value="product">{t("catalog.kind.product")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("catalog.action")}</span>
          <select
            className="input"
            value={draft.action}
            onChange={(e) => set({ action: e.target.value as Draft["action"] })}
          >
            <option value="ask">{t("catalog.action.ask")}</option>
            <option value="quote">{t("catalog.action.quote")}</option>
            <option value="book">{t("catalog.action.book")}</option>
          </select>
        </label>
      </div>
    </div>
  );
}

const toBody = (draft: Draft) => ({
  kind: draft.kind,
  name: draft.name,
  description: draft.description || null,
  priceText: draft.priceText || null,
  category: draft.category || null,
  action: draft.action,
});

/** Services and products shown as cards on the business page (Business page tab). */
export function CatalogSection({ base, onSaved }: { base: string; onSaved: () => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [limit, setLimit] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api<{ items: CatalogItem[]; limit: number }>(`${base}/catalog`);
    setItems(data.items);
    setLimit(data.limit);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      onSaved();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues[0]?.message ?? err.message) : t("common.error"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run(() => api(`${base}/catalog`, { method: "POST", body: toBody(draft) }))) setDraft(EMPTY);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const { id, draft: changed } = editing;
    if (await run(() => api(`${base}/catalog/${id}`, { method: "PATCH", body: toBody(changed) }))) {
      setEditing(null);
    }
  }

  function move(index: number, by: -1 | 1) {
    if (!items) return;
    const ids = items.map((i) => i.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    void run(() => api(`${base}/catalog/order`, { method: "POST", body: { ids } }));
  }

  async function setPhoto(id: string, file: File | undefined) {
    if (!file) return;
    const data = await toUploadable(file);
    if (!data) {
      setError(t("photos.unreadable"));
      return;
    }
    await run(() => api(`${base}/catalog/${id}/photo`, { method: "PUT", body: { data } }));
  }

  const full = items !== null && items.length >= limit;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-lg font-semibold">{t("catalog.title")}</h3>
        <p className="muted text-sm">{t("catalog.hint")}</p>
      </div>

      {items === null ? (
        <p className="muted text-sm">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="muted text-sm">{t("catalog.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item, index) =>
            editing?.id === item.id ? (
              <li key={item.id} className="panel p-4">
                <form className="flex flex-col gap-3" onSubmit={saveEdit}>
                  <ItemFields draft={editing.draft} onChange={(d) => setEditing({ id: item.id, draft: d })} />
                  <div className="flex gap-2">
                    <button className="btn" type="submit" disabled={busy}>
                      {t("common.save")}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                      {t("common.cancel")}
                    </button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={item.id} className="panel flex flex-wrap items-start gap-3 p-3">
                {item.photoUrl ? (
                  // biome-ignore lint/performance/noImgElement: public asset served by the API
                  <img src={item.photoUrl} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                ) : (
                  <div className="h-16 w-16 shrink-0 rounded-xl bg-[var(--surface-2)]" aria-hidden="true" />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5" dir="auto">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{item.name}</span>
                    {item.priceText && <span className="text-sm font-semibold">{item.priceText}</span>}
                    {item.category && <span className="badge">{item.category}</span>}
                    {!item.enabled && <span className="badge">{t("catalog.hidden")}</span>}
                  </div>
                  {item.description && <p className="muted line-clamp-2 text-sm">{item.description}</p>}
                  <p className="muted text-xs">
                    {t(`catalog.kind.${item.kind}`)} · {t(`catalog.action.${item.action}`)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <label className="me-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(e) =>
                        void run(() =>
                          api(`${base}/catalog/${item.id}`, {
                            method: "PATCH",
                            body: { enabled: e.target.checked },
                          }),
                        )
                      }
                    />
                    {t("catalog.enabled")}
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost px-2 py-1"
                    aria-label={t("catalog.up")}
                    title={t("catalog.up")}
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost px-2 py-1"
                    aria-label={t("catalog.down")}
                    title={t("catalog.down")}
                    disabled={busy || index === items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  <label className="btn btn-ghost cursor-pointer py-1">
                    {item.photoUrl ? t("catalog.photoChange") : t("catalog.photoAdd")}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/*"
                      className="sr-only"
                      onChange={(e) => {
                        void setPhoto(item.id, e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {item.photoUrl && (
                    <button
                      type="button"
                      className="btn btn-ghost py-1"
                      onClick={() =>
                        void run(() => api(`${base}/catalog/${item.id}/photo`, { method: "DELETE" }))
                      }
                    >
                      {t("catalog.photoRemove")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost py-1"
                    onClick={() =>
                      setEditing({
                        id: item.id,
                        draft: {
                          kind: item.kind,
                          name: item.name,
                          description: item.description ?? "",
                          priceText: item.priceText ?? "",
                          category: item.category ?? "",
                          action: item.action,
                        },
                      })
                    }
                  >
                    {t("catalog.edit")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost py-1"
                    onClick={() => void run(() => api(`${base}/catalog/${item.id}`, { method: "DELETE" }))}
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {items !== null && (
        <p className="muted text-xs">{t("catalog.count", { count: items.length, limit })}</p>
      )}

      {full ? (
        <p className="muted text-sm">{t("catalog.limit")}</p>
      ) : (
        <form className="panel flex flex-col gap-3 p-4 sm:p-5" onSubmit={add}>
          <h4 className="font-medium">{t("catalog.new")}</h4>
          <ItemFields draft={draft} onChange={setDraft} />
          <div>
            <button className="btn" type="submit" disabled={busy || !draft.name.trim()}>
              {t("catalog.add")}
            </button>
          </div>
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
