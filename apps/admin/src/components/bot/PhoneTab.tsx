"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api, type PhoneNumber, type PhoneSettings } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/**
 * The assistant's phone number (docs/PHONE_AND_SMS.md): what texts and calls to it do, how the
 * business forwards its missed calls to it, and, for Traiblazer staff, assigning the number.
 */
export function PhoneTab({ base }: { base: string }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<PhoneSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSettings(await api<PhoneSettings>(`${base}/phone`));
  }, [base]);

  useEffect(() => {
    void load().catch(() => setError(t("common.error")));
  }, [load, t]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await action();
      await load();
      setSaved(true);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues[0]?.message ?? err.message) : t("common.error"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const change = (body: Partial<Pick<PhoneNumber, "smsEnabled" | "callMode">>) =>
    run(() => api(`${base}/phone`, { method: "PATCH", body }));

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const number = new FormData(form).get("number");
    if (await run(() => api(`${base}/phone`, { method: "PUT", body: { number } }))) form.reset();
  }

  if (!settings) {
    return error ? (
      <p className="error text-sm" role="alert">
        {error}
      </p>
    ) : (
      <p className="muted text-sm">{t("common.loading")}</p>
    );
  }
  const { phone } = settings;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">{t("phone.title")}</h2>
        <p className="muted max-w-3xl text-sm">{t("phone.intro")}</p>
      </div>

      {!settings.available ? (
        <p className="panel p-4 text-sm">{t("phone.unavailable")}</p>
      ) : !phone ? (
        <p className="panel p-4 text-sm">{t("phone.none")}</p>
      ) : (
        <>
          <div className="panel flex flex-col gap-1 p-4 sm:p-5">
            <span className="muted text-sm">{t("phone.number")}</span>
            <a className="text-2xl font-semibold" href={`tel:${phone.e164}`} dir="ltr">
              {phone.display}
            </a>
            <p className="muted text-sm">
              {t("phone.stats", {
                texts: settings.stats.textsSent30Days,
                stopped: settings.stats.optOuts,
              })}
            </p>
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">{t("phone.texts.title")}</h3>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={phone.smsEnabled}
                disabled={busy}
                onChange={(e) => void change({ smsEnabled: e.target.checked })}
              />
              <span className="font-medium">{t("phone.texts.enable")}</span>
            </label>
            <p className="muted max-w-3xl text-sm">{t("phone.texts.hint")}</p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">{t("phone.calls.title")}</h3>
            <label className="flex flex-col gap-1 text-sm">
              {t("phone.calls.label")}
              <select
                className="input max-w-md"
                value={phone.callMode}
                disabled={busy}
                onChange={(e) => void change({ callMode: e.target.value as PhoneNumber["callMode"] })}
              >
                <option value="text_back">{t("phone.calls.textBack")}</option>
                <option value="off">{t("phone.calls.off")}</option>
              </select>
            </label>
            <p className="muted max-w-3xl text-sm">{t("phone.calls.hint")}</p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">{t("phone.forward.title")}</h3>
            <p className="max-w-3xl text-sm">{t("phone.forward.intro")}</p>
            <ul className="max-w-3xl list-disc ps-5 text-sm">
              <li>{t("phone.forward.mobile")}</li>
              <li>{t("phone.forward.landline")}</li>
            </ul>
            <p className="max-w-3xl text-sm">{t("phone.forward.test")}</p>
          </section>
        </>
      )}

      {settings.canAssign && settings.available && (
        <section className="panel flex flex-col gap-3 p-4 sm:p-5">
          <div>
            <h3 className="font-semibold">{t("phone.staff.title")}</h3>
            <p className="muted text-sm">{t("phone.staff.hint")}</p>
          </div>
          {settings.webhooks && (
            <dl className="grid gap-x-5 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="muted">{t("phone.staff.webhookSms")}</dt>
              <dd className="break-all" dir="ltr">
                <code>{settings.webhooks.sms}</code>
              </dd>
              <dt className="muted">{t("phone.staff.webhookVoice")}</dt>
              <dd className="break-all" dir="ltr">
                <code>{settings.webhooks.voice}</code>
              </dd>
            </dl>
          )}
          <form className="flex flex-wrap items-end gap-3" onSubmit={assign}>
            <label className="flex flex-col gap-1 text-sm">
              {t("phone.staff.number")}
              <input
                className="input"
                name="number"
                type="tel"
                required
                autoComplete="off"
                placeholder="+1 807 555 0142"
                dir="ltr"
              />
            </label>
            <button className="btn" type="submit" disabled={busy}>
              {phone ? t("phone.staff.replace") : t("phone.staff.assign")}
            </button>
            {phone && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t("phone.staff.removeConfirm"))) {
                    void run(() => api(`${base}/phone`, { method: "DELETE" }));
                  }
                }}
              >
                {t("phone.staff.remove")}
              </button>
            )}
          </form>
        </section>
      )}

      <div aria-live="polite" className="min-h-5 text-sm">
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          saved && <p className="muted">{t("phone.saved")}</p>
        )}
      </div>
    </div>
  );
}
