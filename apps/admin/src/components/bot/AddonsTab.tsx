"use client";

import type { MessageKey } from "@traiblazer/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  type AddonCatalogEntry,
  type AddonCategory,
  type AddonField,
  ApiError,
  api,
  type InstalledAddon,
  type Localized,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Filter = "all" | "installed" | AddonCategory;

/**
 * Add-on market for one assistant: browse add-ons, install them, change their settings, turn them
 * off or remove them. Settings forms are built from each add-on's field list, so a new add-on
 * needs no portal changes.
 */
export function AddonsTab({ base }: { base: string }) {
  const { t, language } = useI18n();
  const loc = (text: Localized) => (language === "fr" ? text.fr : text.en);
  const [catalog, setCatalog] = useState<AddonCatalogEntry[] | null>(null);
  const [installed, setInstalled] = useState<InstalledAddon[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ catalog: AddonCatalogEntry[]; installed: InstalledAddon[] }>(`${base}/addons`);
      setCatalog(data.catalog);
      setInstalled(data.installed);
    } catch {
      setLoadError(true);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) return <p className="error text-sm">{t("common.error")}</p>;
  if (!catalog) return <p className="muted text-sm">{t("common.loading")}</p>;

  const installedById = new Map(installed.map((i) => [i.addonId, i]));
  const categories = [...new Set(catalog.map((a) => a.category))];
  const needle = query.trim().toLowerCase();
  const visible = catalog.filter((a) => {
    if (filter === "installed" && !installedById.has(a.id)) return false;
    if (filter !== "all" && filter !== "installed" && a.category !== filter) return false;
    return !needle || `${loc(a.name)} ${loc(a.summary)}`.toLowerCase().includes(needle);
  });
  // Installed first, then available, then coming soon (market order inside each group).
  const rank = (a: AddonCatalogEntry) => (installedById.has(a.id) ? 0 : a.status === "available" ? 1 : 2);
  visible.sort((a, b) => rank(a) - rank(b));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold">{t("addons.title")}</h3>
        <p className="muted text-sm">{t("addons.hint")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "installed", ...categories] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            className="chip"
            data-selected={filter === f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {t(`addons.filter.${f}` as MessageKey)}
            {f === "installed" && installed.length > 0 && ` (${installed.length})`}
          </button>
        ))}
        <input
          className="input ms-auto max-w-xs"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("addons.search")}
          aria-label={t("addons.search")}
        />
      </div>

      {visible.length === 0 ? (
        <p className="muted text-sm">
          {filter === "installed" && !needle ? t("addons.noneInstalled") : t("addons.empty")}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((addon) => {
            const current = installedById.get(addon.id);
            const isOpen = open === addon.id;
            return (
              <li
                key={addon.id}
                className={`panel flex flex-col gap-3 p-4 ${isOpen ? "sm:col-span-2" : ""} ${
                  addon.status === "coming_soon" ? "opacity-70" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--surface-2)] text-2xl"
                  >
                    {addon.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-medium">{loc(addon.name)}</h4>
                      <StatusBadge addon={addon} current={current} />
                    </div>
                    <p className="muted mt-0.5 text-sm">{loc(addon.summary)}</p>
                  </div>
                  <AddonAction
                    addon={addon}
                    current={current}
                    isOpen={isOpen}
                    onToggle={() => setOpen(isOpen ? null : addon.id)}
                  />
                </div>

                <p className="muted flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span>{t(`addons.category.${addon.category}` as MessageKey)}</span>
                  {addon.capabilities.map((c) => (
                    <span key={c}>· {t(`addons.capability.${c}` as MessageKey)}</span>
                  ))}
                </p>

                {isOpen && (
                  <AddonSettings
                    key={current?.updatedAt ?? "new"}
                    addon={addon}
                    current={current}
                    base={base}
                    loc={loc}
                    onDone={async (close) => {
                      await load();
                      if (close) setOpen(null);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ addon, current }: { addon: AddonCatalogEntry; current?: InstalledAddon }) {
  const { t } = useI18n();
  if (addon.status === "coming_soon") return <span className="badge">{t("addons.comingSoon")}</span>;
  if (!current) return null;
  if (current.status !== "ok") return <span className="badge error">{t("addons.needsAttention")}</span>;
  return current.enabled ? (
    <span className="badge badge-accent">✓ {t("addons.on")}</span>
  ) : (
    <span className="badge">{t("addons.off")}</span>
  );
}

function AddonAction(props: {
  addon: AddonCatalogEntry;
  current?: InstalledAddon;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  if (props.addon.status === "coming_soon") return null;
  if (props.isOpen) {
    return (
      <button type="button" className="btn btn-ghost shrink-0" onClick={props.onToggle}>
        {t("common.close")}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={props.current ? "btn btn-ghost shrink-0" : "btn shrink-0"}
      onClick={props.onToggle}
    >
      {props.current ? t("addons.settings") : `+ ${t("addons.add")}`}
    </button>
  );
}

function AddonSettings(props: {
  addon: AddonCatalogEntry;
  current?: InstalledAddon;
  base: string;
  loc: (text: Localized) => string;
  onDone: (close: boolean) => Promise<void>;
}) {
  const { addon, current, base, loc, onDone } = props;
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, unknown>>({ ...addon.defaults, ...current?.config });
  const [enabled, setEnabled] = useState(current?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const url = `${base}/addons/${addon.id}`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await api(url, { method: "PUT", body: { enabled, config: values } });
      await onDone(!current);
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(Object.fromEntries(err.issues.map((i) => [i.path.split(".")[0] ?? "", i.message])));
        setError(err.status === 403 ? t("addons.adminOnly") : err.message);
      } else setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("addons.removeConfirm", { name: loc(addon.name) }))) return;
    setBusy(true);
    try {
      await api(url, { method: "DELETE" });
      await onDone(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? t("addons.adminOnly") : t("common.error"));
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4 border-t border-[var(--border)] pt-4" onSubmit={onSubmit}>
      <p className="text-sm">{loc(addon.description)}</p>

      {current && (
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t("addons.enabled")}
        </label>
      )}

      {addon.fields.map((field) => (
        <Field
          key={field.key}
          field={field}
          value={values[field.key]}
          error={fieldErrors[field.key]}
          loc={loc}
          onChange={(value) => setValues((v) => ({ ...v, [field.key]: value }))}
        />
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" type="submit" disabled={busy}>
          {current ? t("common.save") : t("addons.install")}
        </button>
        {current && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={remove}>
            {t("addons.remove")}
          </button>
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

function Field(props: {
  field: AddonField;
  value: unknown;
  error?: string;
  loc: (text: Localized) => string;
  onChange: (value: unknown) => void;
}) {
  const { field, value, error, loc, onChange } = props;
  const id = `addon-field-${field.key}`;
  const hint = field.hint && <span className="muted text-xs">{loc(field.hint)}</span>;
  const problem = error && (
    <span className="error text-xs" role="alert">
      {error}
    </span>
  );

  if (field.type === "toggle") {
    return (
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="flex flex-col">
          {loc(field.label)}
          {hint}
        </span>
      </label>
    );
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {loc(field.label)}
      </label>
      {field.type === "select" ? (
        <select
          id={id}
          className="input"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {loc(o.label)}
            </option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea
          id={id}
          className="input"
          rows={3}
          maxLength={field.maxLength}
          required={field.required}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          dir="auto"
        />
      ) : (
        <input
          id={id}
          className="input"
          type={field.type}
          maxLength={field.maxLength}
          required={field.required}
          placeholder={field.placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          dir={field.type === "text" ? "auto" : "ltr"}
          aria-invalid={!!error}
        />
      )}
      {hint}
      {problem}
    </div>
  );
}
