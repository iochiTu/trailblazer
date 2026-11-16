"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  disablePush,
  enablePush,
  type PushState,
  type PushSupport,
  pushState,
  pushSupport,
} from "@/lib/push";

/**
 * Turns push notifications on or off on this device, or says why it can't (blocked, iPhone
 * Safari without the app, no Web Push).
 */
export function PushControl() {
  const { t } = useI18n();
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    const found = await pushSupport().catch((): PushSupport => "unsupported");
    setSupport(found);
    if (found === "native" || found === "web") setState(await pushState().catch((): PushState => "off"));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function turnOn() {
    setBusy(true);
    setError(false);
    try {
      setState(
        await enablePush({ urgent: t("notify.channel.urgent"), requests: t("notify.channel.requests") }),
      );
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      await disablePush();
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  if (support === null) return null;
  const canPush = support === "native" || support === "web";

  return (
    <section className="card flex flex-col gap-3 p-5" aria-labelledby="push-device">
      <h2 id="push-device" className="font-semibold">
        {t("notify.device")}
      </h2>
      {support === "ios-install" && <p className="text-sm">{t("notify.iosInstall")}</p>}
      {support === "unsupported" && <p className="muted text-sm">{t("notify.unsupported")}</p>}
      {canPush && state === "denied" && <p className="text-sm">{t("notify.denied")}</p>}
      {canPush && (state === "on" || state === "off") && (
        <>
          <p className="text-sm" role="status">
            {state === "on" ? `✓ ${t("notify.on")}` : t("notify.off")}
          </p>
          <div>
            {state === "on" ? (
              <button type="button" className="btn btn-ghost" onClick={turnOff} disabled={busy}>
                {t("notify.turnOff")}
              </button>
            ) : (
              <button type="button" className="btn" onClick={turnOn} disabled={busy}>
                {t("notify.turnOn")}
              </button>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="error text-sm" role="alert">
          {t("notify.error")}
        </p>
      )}
    </section>
  );
}
