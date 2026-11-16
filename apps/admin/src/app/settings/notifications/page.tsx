"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { PushControl } from "@/components/app/PushControl";
import { PAUSE_EVENT } from "@/components/app/SwitchBar";
import { lastTenant, useMe } from "@/components/app/useMe";
import { ApiError, api, type NotificationEvent, type NotificationPrefs } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const EVENTS: NotificationEvent[] = ["request.urgent", "request.new", "request.comment"];
const DEFAULT_QUIET = { start: "22:00", end: "07:00" };

/**
 * Notification settings (PLAN §20.4): turn pushes on for this phone, choose what to hear about,
 * and quiet hours in the phone's own time zone. The choices follow the user to every device.
 */
function NotificationSettings() {
  const { t } = useI18n();
  const params = useSearchParams();
  useMe();
  const [tenantId, setTenantId] = useState<string | null>(params.get("t"));
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | string>("idle");
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    setTenantId((current) => current ?? lastTenant());
    api<{ prefs: NotificationPrefs }>("/v1/me/notification-prefs")
      .then((d) => setPrefs(d.prefs))
      .catch(() => setStatus(t("common.error")));
  }, [t]);

  // The switch at the top pauses everything: say so here, and keep it in step.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const read = () =>
      api<{ prefs: NotificationPrefs }>("/v1/me/notification-prefs")
        .then((d) => setPaused(Boolean(d.prefs.paused)))
        .catch(() => undefined);
    void read();
    window.addEventListener(PAUSE_EVENT, read);
    return () => window.removeEventListener(PAUSE_EVENT, read);
  }, []);

  /** Saves at once: one tap is one change, no save button to forget. */
  async function save(next: NotificationPrefs) {
    setPrefs(next);
    setStatus("saving");
    try {
      const { paused: _, ...form } = next;
      await api("/v1/me/notification-prefs", { method: "PUT", body: form });
      setStatus("saved");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  const quietOn = prefs !== null && prefs.quietStart !== null;

  return (
    <AppShell title={t("notify.title")} tab="alerts" tenantId={tenantId}>
      <p className="muted text-sm">{t("notify.intro")}</p>
      {paused && (
        <p className="panel p-4 text-sm font-medium" role="status">
          {t("switch.paused")}
        </p>
      )}
      <PushControl />

      {prefs && (
        <>
          <fieldset className="card p-5">
            <div className="flex flex-col gap-1">
              <legend className="float-start mb-2 w-full font-semibold">{t("notify.events")}</legend>
              {EVENTS.map((event) => (
                <label key={event} className="flex min-h-12 items-start gap-3 py-2">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0"
                    checked={prefs.events[event] !== false}
                    onChange={(e) =>
                      save({ ...prefs, events: { ...prefs.events, [event]: e.target.checked } })
                    }
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{t(`notify.event.${event}`)}</span>
                    <span className="muted text-sm">{t(`notify.event.${event}.help`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="card p-5">
            <div className="flex flex-col gap-3">
              <legend className="float-start mb-2 w-full font-semibold">{t("notify.quiet")}</legend>
              <p className="muted text-sm">{t("notify.quietIntro", { zone })}</p>
              <label className="flex min-h-12 items-center gap-3">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={quietOn}
                  onChange={(e) =>
                    save(
                      e.target.checked
                        ? {
                            ...prefs,
                            quietStart: DEFAULT_QUIET.start,
                            quietEnd: DEFAULT_QUIET.end,
                            timeZone: zone,
                          }
                        : { ...prefs, quietStart: null, quietEnd: null },
                    )
                  }
                />
                <span className="font-medium">{t("notify.quietOn")}</span>
              </label>
              {quietOn && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="muted">{t("notify.quietFrom")}</span>
                      <input
                        type="time"
                        className="input"
                        value={prefs.quietStart ?? ""}
                        onChange={(e) =>
                          e.target.value && save({ ...prefs, quietStart: e.target.value, timeZone: zone })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="muted">{t("notify.quietTo")}</span>
                      <input
                        type="time"
                        className="input"
                        value={prefs.quietEnd ?? ""}
                        onChange={(e) =>
                          e.target.value && save({ ...prefs, quietEnd: e.target.value, timeZone: zone })
                        }
                      />
                    </label>
                  </div>
                  <label className="flex min-h-12 items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={prefs.urgentInQuietHours}
                      onChange={(e) => save({ ...prefs, urgentInQuietHours: e.target.checked })}
                    />
                    <span className="font-medium">{t("notify.urgentInQuiet")}</span>
                  </label>
                </>
              )}
            </div>
          </fieldset>
          <p className="muted text-xs">{t("notify.allDevices")}</p>
        </>
      )}

      <p
        className={`text-sm ${status !== "idle" && status !== "saving" && status !== "saved" ? "error" : "muted"}`}
        role="status"
      >
        {status === "saved"
          ? `✓ ${t("common.saved")}`
          : status === "idle" || status === "saving"
            ? ""
            : status}
      </p>
    </AppShell>
  );
}

export default function NotificationSettingsPage() {
  return (
    <Suspense>
      <NotificationSettings />
    </Suspense>
  );
}
