"use client";

import { type FormEvent, useState } from "react";
import { type Agency, ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** What the agency's clients see in place of our name (docs/AGENCY.md §5). */
export function AgencyBranding({ agency, onSaved }: { agency: Agency; onSaved: (agency: Agency) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [poweredBy, setPoweredBy] = useState<"none" | "agency">(agency.branding.poweredBy ?? "none");
  const [color, setColor] = useState(agency.branding.color ?? "#1f6f5c");
  const [logoUrl, setLogoUrl] = useState(agency.branding.logoUrl ?? "");
  const canEdit = agency.role !== "member";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = String(data.get(key) ?? "").trim();
      return value === "" ? null : value;
    };
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ agency: Agency }>(`/v1/agencies/${agency.id}/branding`, {
        method: "PATCH",
        body: {
          logoUrl: text("logoUrl"),
          color,
          supportEmail: text("supportEmail"),
          website: text("website"),
          poweredBy,
        },
      });
      onSaved(res.agency);
      setMessage({ kind: "ok", text: t("agency.branding.saved") });
    } catch (err) {
      setMessage({
        kind: "error",
        text:
          err instanceof ApiError && err.status < 500
            ? (err.issues[0]?.message ?? err.message)
            : t("common.error"),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card flex flex-col gap-5 p-5 sm:p-7" onSubmit={onSubmit}>
      <p className="muted text-sm">{t("agency.branding.intro")}</p>

      {/* How the portal header will look for the agency's clients. */}
      <div
        className="flex items-center gap-3 self-start rounded-2xl px-4 py-3 text-white"
        style={{ background: "var(--sidenav-bg, #10172a)" }}
        aria-hidden="true"
      >
        {logoUrl.startsWith("https://") ? (
          // biome-ignore lint/performance/noImgElement: preview of the agency's own logo address
          <img
            src={logoUrl}
            alt=""
            width={30}
            height={30}
            className="h-[30px] w-[30px] rounded-md object-contain"
          />
        ) : (
          <span className="h-[30px] w-[30px] rounded-md" style={{ background: color }} />
        )}
        <span className="font-semibold">{agency.name}</span>
      </div>

      <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          {t("agency.branding.logo")}
          <input
            className="input"
            name="logoUrl"
            type="url"
            placeholder="https://"
            maxLength={500}
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("agency.branding.color")}
          <input
            className="input h-11 p-1"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("agency.branding.supportEmail")}
          <input
            className="input"
            name="supportEmail"
            type="email"
            maxLength={254}
            defaultValue={agency.branding.supportEmail ?? ""}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          {t("agency.branding.website")}
          <input
            className="input"
            name="website"
            type="url"
            placeholder="https://"
            maxLength={500}
            defaultValue={agency.branding.website ?? agency.website ?? ""}
          />
        </label>
        <fieldset className="flex flex-col gap-2 text-sm sm:col-span-2">
          <legend className="mb-1">{t("agency.branding.poweredBy")}</legend>
          {(["none", "agency"] as const).map((choice) => (
            <label key={choice} className="flex items-center gap-2">
              <input
                type="radio"
                name="poweredBy"
                value={choice}
                checked={poweredBy === choice}
                onChange={() => setPoweredBy(choice)}
              />
              {t(`agency.branding.poweredBy.${choice}`, { agency: agency.name })}
            </label>
          ))}
        </fieldset>
      </fieldset>
      {message && (
        <p
          className={message.kind === "error" ? "error text-sm" : "text-sm"}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
      {canEdit && (
        <div>
          <button className="btn" type="submit" disabled={busy} aria-busy={busy}>
            {t("agency.branding.save")}
          </button>
        </div>
      )}
    </form>
  );
}
