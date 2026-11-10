"use client";

import { type FormEvent, useState } from "react";
import { CopyField } from "@/components/CopyField";
import { ApiError, api, type BotDetail, type BusinessProfile } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { CatalogSection } from "./CatalogSection";
import { NoticesSection } from "./NoticesSection";

/** A friendly link proposed from the business's name (the API has the final say). */
export function suggestSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug.length >= 3 ? slug : "";
}

const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiError ? (err.issues[0]?.message ?? err.message) : fallback;

/** Publishing: on/off, friendly link, layout and search-engine listing. */
function PublishSection({
  detail,
  base,
  pageUrl,
  onChange,
}: {
  detail: BotDetail;
  base: string;
  pageUrl: string;
  onChange: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { bot } = detail;
  const [slug, setSlug] = useState(bot.pageSlug ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listed = bot.settings.page?.listed !== false;
  const preset = bot.settings.page?.preset ?? "business";
  const suggestion = suggestSlug(detail.profile?.businessName ?? bot.name);

  async function patch(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(base, { method: "PATCH", body });
      await onChange();
    } catch (err) {
      setError(errorText(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  function saveSlug(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void patch({ pageSlug: slug.trim() || null });
  }

  const status = !bot.hostedPageEnabled
    ? t("page.status.off")
    : !listed
      ? t("page.status.liveUnlisted")
      : bot.status === "active"
        ? t("page.status.live")
        : t("page.status.draft");

  return (
    <section className="panel flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h3 className="text-lg font-semibold">{t("page.publish.title")}</h3>
          <p
            className="text-sm"
            role="status"
            style={{ color: bot.hostedPageEnabled ? "var(--accent)" : "var(--muted)" }}
          >
            {bot.hostedPageEnabled ? "● " : "○ "}
            {status}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {bot.hostedPageEnabled && (
            <a className="btn btn-ghost" href={pageUrl} target="_blank" rel="noreferrer">
              {t("page.open")}
            </a>
          )}
          <button
            type="button"
            className={bot.hostedPageEnabled ? "btn btn-ghost" : "btn"}
            disabled={busy}
            aria-pressed={bot.hostedPageEnabled}
            onClick={() => void patch({ hostedPageEnabled: !bot.hostedPageEnabled })}
          >
            {bot.hostedPageEnabled ? t("page.unpublish") : t("page.publish")}
          </button>
        </div>
      </div>

      <CopyField value={pageUrl} label={t("share.link")} />

      <form className="flex flex-col gap-2" onSubmit={saveSlug}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("page.slug")}</span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="muted text-sm" dir="ltr">
              {detail.chatUrl}/
            </span>
            <input
              className="input max-w-xs"
              dir="ltr"
              maxLength={60}
              pattern="[a-z0-9][a-z0-9\-]{1,58}[a-z0-9]"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
            <button className="btn" type="submit" disabled={busy || slug.trim() === (bot.pageSlug ?? "")}>
              {t("page.slugSave")}
            </button>
            {bot.pageSlug && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => void patch({ pageSlug: null })}
              >
                {t("page.slugRemove")}
              </button>
            )}
          </div>
        </label>
        <span className="muted text-xs">{bot.pageSlug ? t("page.slugHint") : t("page.slugNone")}</span>
        {!bot.pageSlug && suggestion && slug !== suggestion && (
          <div>
            <button type="button" className="btn btn-ghost py-1 text-sm" onClick={() => setSlug(suggestion)}>
              {t("page.slugSuggest", { slug: suggestion })}
            </button>
          </div>
        )}
      </form>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t("page.preset")}</legend>
        {(["business", "personal"] as const).map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="preset"
              checked={preset === value}
              disabled={busy}
              onChange={() => void patch({ settings: { page: { preset: value } } })}
            />
            {t(`page.preset.${value}`)}
          </label>
        ))}
      </fieldset>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={listed}
          disabled={busy}
          onChange={(e) => void patch({ settings: { page: { listed: e.target.checked } } })}
        />
        <span>
          {t("page.listed")}
          <span className="muted block text-xs">{t("page.listedHint")}</span>
        </span>
      </label>

      {error && (
        <p className="error text-sm" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Description, service area, licences: part of the business profile, edited here. */
function DetailsSection({
  detail,
  base,
  onSaved,
}: {
  detail: BotDetail;
  base: string;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState({
    description: detail.profile?.description ?? "",
    serviceArea: detail.profile?.serviceArea ?? "",
    credentials: detail.profile?.credentials ?? "",
    serviceTowns: (detail.profile?.serviceTowns ?? []).join(", "),
    servicePostalPrefixes: (detail.profile?.servicePostalPrefixes ?? []).join(", "),
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = (text: string) =>
    text
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body: Partial<BusinessProfile> = {
        description: draft.description.trim() || null,
        serviceArea: draft.serviceArea.trim() || null,
        credentials: draft.credentials.trim() || null,
        serviceTowns: list(draft.serviceTowns),
        servicePostalPrefixes: list(draft.servicePostalPrefixes),
      };
      await api(`${base}/profile`, { method: "PUT", body });
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(errorText(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  const fields = [
    { key: "description", label: t("page.description"), hint: t("page.descriptionHint"), rows: 2 },
    { key: "serviceArea", label: t("page.serviceArea"), hint: t("page.serviceAreaHint"), rows: 2 },
    { key: "credentials", label: t("page.credentials"), hint: t("page.credentialsHint"), rows: 2 },
  ] as const;

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div>
        <h3 className="text-lg font-semibold">{t("page.details.title")}</h3>
        <p className="muted text-sm">{t("page.details.hint")}</p>
      </div>
      {fields.map(({ key, label, hint, rows }) => (
        <label key={key} className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{label}</span>
          <textarea
            className="input"
            rows={rows}
            maxLength={300}
            dir="auto"
            value={draft[key]}
            onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          />
          <span className="muted text-xs">{hint}</span>
        </label>
      ))}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{t("page.areaCheck")}</legend>
        <span className="muted text-xs">{t("page.areaCheckHint")}</span>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("page.serviceTowns")}</span>
          <input
            className="input"
            dir="auto"
            placeholder="Guelph, Fergus, Elora"
            value={draft.serviceTowns}
            onChange={(e) => setDraft({ ...draft, serviceTowns: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("page.servicePostalPrefixes")}</span>
          <input
            className="input"
            dir="ltr"
            placeholder="N1H, N1E, N1G, N0B"
            value={draft.servicePostalPrefixes}
            onChange={(e) => setDraft({ ...draft, servicePostalPrefixes: e.target.value })}
          />
          <span className="muted text-xs">{t("page.servicePostalPrefixesHint")}</span>
        </label>
      </fieldset>
      <div className="flex items-center gap-3">
        <button className="btn" type="submit" disabled={busy}>
          {t("page.details.save")}
        </button>
        {saved && (
          <span className="text-sm" role="status" style={{ color: "var(--accent)" }}>
            {t("common.saved")}
          </span>
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

/**
 * The business page (PLAN §7.1): publish it, its friendly link and layout, page details, services
 * and products, notices, and a live preview.
 */
export function PageTab({
  detail,
  base,
  onChange,
}: {
  detail: BotDetail;
  base: string;
  onChange: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [previewKey, setPreviewKey] = useState(0);
  const key = detail.keys[0]?.publicKey;
  if (!key) return null;
  const pageUrl = detail.bot.pageSlug
    ? `${detail.chatUrl}/${detail.bot.pageSlug}`
    : `${detail.chatUrl}/c/${key}`;
  const refresh = () => setPreviewKey((k) => k + 1);
  const changed = async () => {
    await onChange();
    refresh();
  };

  return (
    <div className="flex flex-col gap-8">
      <p className="muted max-w-3xl text-sm">{t("page.intro")}</p>
      <PublishSection detail={detail} base={base} pageUrl={pageUrl} onChange={changed} />
      <DetailsSection detail={detail} base={base} onSaved={changed} />
      <CatalogSection base={base} onSaved={refresh} />
      <NoticesSection base={base} onSaved={refresh} />
      <section className="flex flex-col gap-2">
        <div>
          <h3 className="text-lg font-semibold">{t("page.preview.title")}</h3>
          <p className="muted text-sm">{t("page.preview.hint")}</p>
        </div>
        <iframe
          key={previewKey}
          title={t("page.preview.title")}
          // Admin preview: shown even before the page is published; chats are logged as tests.
          src={`${detail.chatUrl}/c/${key}?preview=1`}
          className="h-[720px] w-full rounded-[20px] border border-[var(--border)] bg-[var(--surface-2)]"
        />
      </section>
    </div>
  );
}
