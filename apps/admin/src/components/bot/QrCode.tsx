"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
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
 * A QR code for the page link, with PNG and SVG downloads: for business cards, flyers, invoices,
 * vehicles and doors. Used on the Business page and Share & install tabs.
 */
export function QrCode({ url, name }: { url: string; name: string }) {
  const { t } = useI18n();
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    // High error correction so a slightly worn or small print still scans.
    QRCode.toDataURL(url, { errorCorrectionLevel: "H", margin: 2, width: 1024 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  async function downloadSvg() {
    const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "H", margin: 2 });
    const href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    download(href, `${fileBase(name)}.svg`);
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">{t("share.qr.title")}</h4>
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
  );
}
