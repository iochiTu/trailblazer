"use client";

import { type FormEvent, useState } from "react";
import { CopyField } from "@/components/CopyField";
import { ApiError, api, type BotDetail } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { WebVersionCard } from "./WebVersionCard";

export function ShareTab({
  detail,
  base,
  onChange,
}: {
  detail: BotDetail;
  base: string;
  onChange: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const key = detail.keys[0];
  if (!key) return null;

  const pageUrl = `${detail.chatUrl}/c/${key.publicKey}`;
  // Colors, picture and label come from the Appearance settings at load time; the code never changes.
  const widgetCode = `<script src="${detail.chatUrl}/widget.js" data-bot="${key.publicKey}" async></script>`;
  const iframeCode = `<iframe src="${pageUrl}?embed=inline" title="Chat" style="width:100%;height:600px;border:0;border-radius:12px" loading="lazy"></iframe>`;

  async function patch(body: unknown) {
    setError(null);
    try {
      await api(base, { method: "PATCH", body });
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  async function addSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError(null);
    try {
      await api(`${base}/allowed-origins`, {
        method: "POST",
        body: { origin: new FormData(form).get("origin") },
      });
      form.reset();
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <WebVersionCard
        url={pageUrl}
        name={detail.profile?.businessName ?? detail.bot.name}
        enabled={detail.bot.hostedPageEnabled}
        onToggle={(enabled) => patch({ hostedPageEnabled: enabled })}
      />

      <p className="muted text-sm">{t("share.websiteIntro")}</p>

      <section className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold">{t("share.widget")}</h3>
        <p className="muted text-sm">{t("share.widgetHint")}</p>
        <CopyField value={widgetCode} multiline label={t("share.widget")} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold">{t("share.inline")}</h3>
        <p className="muted text-sm">{t("share.inlineHint")}</p>
        <CopyField value={iframeCode} multiline label={t("share.inline")} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold">{t("share.sites")}</h3>
        <p className="muted text-sm">{t("share.sitesHint")}</p>
        <ul className="text-sm" dir="ltr">
          {key.allowedOrigins.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
        <form className="flex flex-wrap items-end gap-2" onSubmit={addSite}>
          <input
            className="input max-w-sm"
            name="origin"
            type="url"
            required
            placeholder="https://www.example.com"
            dir="ltr"
            aria-label={t("share.addSite")}
          />
          <button className="btn" type="submit">
            {t("share.addSite")}
          </button>
        </form>
      </section>

      {error && (
        <p className="error text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
