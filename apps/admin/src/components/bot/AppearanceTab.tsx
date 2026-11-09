"use client";

import {
  AVATAR_ICON_IDS,
  type AvatarIcon,
  DEFAULT_COLOR,
  DEFAULT_THEME,
  iconSvg,
  initialsOf,
  paletteFor,
  type ThemeId,
  themeInfo,
} from "@traiblazer/appearance";
import { type ReactNode, useState } from "react";
import { ApiError, api, type BotDetail } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { BrandColorPicker } from "./BrandColorPicker";

type Settings = BotDetail["bot"]["settings"];
type AvatarKind = "initials" | "icon" | "image";

/** Crops an image file to a centered square and returns base64 (WebP, or PNG if unsupported). */
async function toSquareImage(file: File, size = 256): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("unreadable image"));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    canvas
      .getContext("2d")!
      .drawImage(
        img,
        (img.naturalWidth - side) / 2,
        (img.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );
    return canvas.toDataURL("image/webp", 0.9).split(",")[1]!;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function AvatarPreview({
  settings,
  name,
  chatUrl,
  size = 48,
}: {
  settings: Settings;
  name: string;
  chatUrl: string;
  size?: number;
}) {
  const color = settings.color ?? DEFAULT_COLOR;
  const palette = paletteFor(color, "classic");
  const style = { width: size, height: size, background: palette.brand, color: palette.onBrand };
  const avatar = settings.avatar;
  if (avatar?.kind === "image") {
    return (
      // biome-ignore lint/performance/noImgElement: tiny remote avatar from the chat service
      <img
        src={`${chatUrl}/v1/public/assets/${avatar.assetId}`}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  if (avatar?.kind === "icon") {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full"
        style={style}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: built-in icon markup, not user input
        dangerouslySetInnerHTML={{ __html: iconSvg(avatar.icon as AvatarIcon, Math.round(size * 0.55)) }}
      />
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold"
      style={{ ...style, fontSize: Math.round(size * 0.4) }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Small static mock of a template, colored with the business's brand color. */
function TemplateThumb({ theme, color }: { theme: ThemeId; color: string }) {
  const p = paletteFor(color, theme);
  const dark = theme === "midnight";
  const headerBg = theme === "minimal" ? "#ffffff" : dark ? "#0f0f11" : p.brand;
  const body = dark
    ? "#17171a"
    : theme === "friendly"
      ? `color-mix(in srgb, ${p.brand} 8%, #fff)`
      : "#ffffff";
  const bubble = dark ? "#222227" : theme === "minimal" ? "#f5f5f3" : "#f1f1ee";
  const user = theme === "bold" || dark ? p.brand : `color-mix(in srgb, ${p.brand} 14%, #fff)`;
  const r = theme === "friendly" ? 10 : theme === "minimal" ? 3 : 6;
  return (
    <div
      className="overflow-hidden rounded-xl border border-[var(--border)]"
      style={{ background: body }}
      aria-hidden="true"
    >
      <div
        style={{
          background: headerBg,
          height: theme === "bold" ? 26 : 16,
          borderBottom: theme === "minimal" ? "1px solid #e3e3de" : dark ? `2px solid ${p.brand}` : undefined,
          borderRadius: theme === "friendly" ? "0 0 8px 8px" : undefined,
        }}
      />
      <div className="flex flex-col gap-1 p-2">
        <div style={{ background: bubble, height: 10, width: "70%", borderRadius: r }} />
        <div style={{ background: user, height: 10, width: "50%", borderRadius: r, alignSelf: "flex-end" }} />
        <div style={{ background: bubble, height: 10, width: "60%", borderRadius: r }} />
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        {hint && <p className="muted text-sm">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function AppearanceTab({
  detail,
  base,
  tenantId,
  onChange,
}: {
  detail: BotDetail;
  base: string;
  tenantId: string;
  onChange: () => Promise<void>;
}) {
  const { t, language } = useI18n();
  const { bot } = detail;
  const settings = bot.settings;
  const businessName = detail.profile?.businessName ?? bot.name;
  const theme = (settings.theme as ThemeId | undefined) ?? DEFAULT_THEME;
  const color = settings.color ?? DEFAULT_COLOR;
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewMode, setPreviewMode] = useState<"inline" | "widget">("widget");
  const [avatarKind, setAvatarKind] = useState<AvatarKind>(settings.avatar?.kind ?? "initials");
  const [uploading, setUploading] = useState(false);
  const lang2 = language === "fr" ? "fr" : "en";
  const key = detail.keys[0]?.publicKey;

  async function save(patch: Partial<Settings>) {
    setError(null);
    setSaved(false);
    try {
      await api(base, { method: "PATCH", body: { settings: patch } });
      await onChange();
      setPreviewKey((k) => k + 1);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const data = await toSquareImage(file);
      const { asset } = await api<{ asset: { id: string } }>(`/v1/tenants/${tenantId}/assets`, {
        method: "POST",
        body: { kind: "avatar", data },
      });
      await save({ avatar: { kind: "image", assetId: asset.id } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setUploading(false);
    }
  }

  const displayName = settings.assistantName?.trim() || businessName;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="flex flex-col gap-8">
        <Section title={t("appearance.template")} hint={t("appearance.templateHint")}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {themeInfo.map((info) => (
              <button
                key={info.id}
                type="button"
                aria-pressed={theme === info.id}
                onClick={() => info.id !== theme && void save({ theme: info.id })}
                className={`flex flex-col gap-2 rounded-[20px] p-2.5 text-start ${
                  theme === info.id
                    ? "bg-[var(--accent-soft)] ring-2 ring-[var(--accent)]"
                    : "bg-[var(--surface-2)] hover:bg-[var(--surface-3)]"
                }`}
              >
                <TemplateThumb theme={info.id} color={color} />
                <span className="text-sm font-medium">{info.name[lang2]}</span>
                <span className="muted text-xs">{info.description[lang2]}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title={t("appearance.color")} hint={t("appearance.colorHint")}>
          <BrandColorPicker
            value={color}
            onChange={(next) => {
              if (next.toLowerCase() !== color.toLowerCase()) void save({ color: next });
            }}
          />
        </Section>

        <Section title={t("appearance.identity")}>
          <div className="flex items-center gap-3">
            <AvatarPreview settings={settings} name={displayName} chatUrl={detail.chatUrl} />
            <div className="flex flex-col">
              <span className="font-medium" dir="auto">
                {displayName}
              </span>
              {displayName !== businessName && <span className="muted text-sm">{businessName}</span>}
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm">{t("appearance.avatar")}</legend>
            <div className="flex flex-wrap gap-2">
              {(["initials", "icon", "image"] as const).map((kind) => (
                <label key={kind} className="chip">
                  <input
                    type="radio"
                    name="avatarKind"
                    checked={avatarKind === kind}
                    onChange={() => {
                      setAvatarKind(kind);
                      if (kind === "initials") void save({ avatar: { kind: "initials" } });
                    }}
                  />
                  {t(kind === "image" ? "appearance.avatar.photo" : `appearance.avatar.${kind}`)}
                </label>
              ))}
            </div>

            {avatarKind === "icon" && (
              <div className="flex flex-wrap gap-2">
                {AVATAR_ICON_IDS.map((icon) => {
                  const selected = settings.avatar?.kind === "icon" && settings.avatar.icon === icon;
                  return (
                    <button
                      key={icon}
                      type="button"
                      aria-pressed={selected}
                      aria-label={icon}
                      title={icon}
                      onClick={() => void save({ avatar: { kind: "icon", icon } })}
                      className={`flex h-10 w-10 items-center justify-center rounded-full ${
                        selected
                          ? "bg-[var(--accent-soft)] text-[var(--accent-soft-text)] ring-2 ring-[var(--accent)]"
                          : "bg-[var(--surface-2)] hover:bg-[var(--surface-3)]"
                      }`}
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: built-in icon markup, not user input
                      dangerouslySetInnerHTML={{ __html: iconSvg(icon, 20) }}
                    />
                  );
                })}
              </div>
            )}

            {avatarKind === "image" && (
              <div className="flex flex-col gap-1">
                <label className="btn btn-ghost w-fit cursor-pointer">
                  {uploading ? t("common.loading") : t("appearance.upload")}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    disabled={uploading}
                    onChange={(e) => void upload(e.target.files?.[0])}
                  />
                </label>
                <span className="muted text-xs">{t("appearance.uploadHint")}</span>
              </div>
            )}
          </fieldset>
        </Section>

        <Section title={t("appearance.launcher")}>
          <div className="flex gap-4 text-sm" role="radiogroup" aria-label={t("appearance.position")}>
            {(["right", "left"] as const).map((pos) => (
              <label key={pos} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="launcherPosition"
                  value={pos}
                  checked={(settings.launcherPosition ?? "right") === pos}
                  onChange={() => void save({ launcherPosition: pos })}
                />
                {t(`appearance.position.${pos}`)}
              </label>
            ))}
          </div>
        </Section>

        {saved && (
          <p className="text-sm" role="status" style={{ color: "var(--accent)" }}>
            {t("common.saved")}
          </p>
        )}

        {error && (
          <p className="error text-sm" role="alert">
            {error}
          </p>
        )}
      </div>

      {key && (
        <aside className="flex flex-col gap-2 lg:sticky lg:top-4 lg:self-start">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{t("appearance.preview")}</h3>
            <div className="tabs tabs-sm" role="tablist">
              {(["widget", "inline"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={previewMode === mode}
                  className="tab"
                  onClick={() => setPreviewMode(mode)}
                >
                  {t(mode === "inline" ? "appearance.preview.web" : "appearance.preview.widget")}
                </button>
              ))}
            </div>
          </div>
          <iframe
            key={`${previewKey}-${previewMode}`}
            title={t("appearance.preview")}
            src={`${detail.chatUrl}/c/${key}?embed=${previewMode}&preview=1`}
            className="h-[560px] w-full rounded-[24px] bg-[var(--surface-2)] shadow-[var(--shadow-2)]"
          />
        </aside>
      )}
    </div>
  );
}
