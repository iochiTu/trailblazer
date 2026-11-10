"use client";

import { useState } from "react";
import { CopyField } from "@/components/CopyField";
import { useI18n } from "@/lib/i18n";
import { QrCode } from "./QrCode";

/**
 * The business's "web version": a ready-made chat page reached by link or QR code, for businesses
 * (e.g. independent contractors) without a website. Owners switch it on or off here.
 */
export function WebVersionCard({
  url,
  name,
  enabled,
  onToggle,
}: {
  url: string;
  name: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await onToggle(!enabled);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h3 className="text-lg font-semibold">{t("share.web.title")}</h3>
          <p className="muted text-sm">{t("share.web.hint")}</p>
        </div>
        <button
          type="button"
          className={enabled ? "btn btn-ghost" : "btn"}
          onClick={toggle}
          disabled={busy}
          aria-pressed={enabled}
        >
          {enabled ? t("share.web.deactivate") : t("share.web.activate")}
        </button>
      </div>

      <p className="text-sm" role="status" style={{ color: enabled ? "var(--accent)" : "var(--muted)" }}>
        {enabled ? `● ${t("share.web.on")}` : `○ ${t("share.web.off")}`}
      </p>

      {enabled && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-medium">{t("share.link")}</h4>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <CopyField value={url} label={t("share.link")} />
              </div>
              <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">
                {t("share.open")}
              </a>
            </div>
          </div>
          <QrCode url={url} name={name} />
        </div>
      )}
    </section>
  );
}
