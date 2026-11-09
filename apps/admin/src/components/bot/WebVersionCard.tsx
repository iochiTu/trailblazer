"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { CopyField } from "@/components/CopyField";
import { useI18n } from "@/lib/i18n";

/** File-name-safe version of the business name for downloads. */
const fileBase = (name: string) =>
  `${
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "chat"
  }-qr`;

function download(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
}

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
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // High error correction so a slightly worn or small print still scans.
    QRCode.toDataURL(url, { errorCorrectionLevel: "H", margin: 2, width: 1024 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  async function toggle() {
    setBusy(true);
    try {
      await onToggle(!enabled);
    } finally {
      setBusy(false);
    }
  }

  async function downloadSvg() {
    const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "H", margin: 2 });
    const href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    download(href, `${fileBase(name)}.svg`);
    setTimeout(() => URL.revokeObjectURL(href), 1000);
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
        <div className="grid gap-5 md:grid-cols-[1fr_auto]">
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
            <h4 className="mt-2 text-sm font-medium">{t("share.qr.title")}</h4>
            <p className="muted text-sm">{t("share.qr.hint")}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn"
                disabled={!qr}
                onClick={() => qr && download(qr, `${fileBase(name)}.png`)}
              >
                {t("share.qr.png")}
              </button>
              <button type="button" className="btn btn-ghost" onClick={downloadSvg}>
                {t("share.qr.svg")}
              </button>
            </div>
          </div>
          {qr && (
            <figure className="flex flex-col items-center gap-1">
              {/* biome-ignore lint/performance/noImgElement: data URL, nothing for next/image to optimize */}
              <img
                src={qr}
                alt={t("share.qr.alt", { name })}
                width={180}
                height={180}
                className="rounded-lg border border-[var(--border)] bg-white p-1"
              />
              <figcaption className="muted max-w-[180px] text-center text-xs">{name}</figcaption>
            </figure>
          )}
        </div>
      )}
    </section>
  );
}
