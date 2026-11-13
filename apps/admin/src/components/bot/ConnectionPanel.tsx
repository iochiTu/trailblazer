"use client";

import { type FormEvent, useState } from "react";
import { ApiError, api, type Integration, type Localized } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/**
 * The "Connect" step of a CRM add-on: shows whether the assistant is connected to the CRM, and
 * lets an admin connect (by pasting keys, or by signing in at the CRM), reconnect or disconnect.
 * Keys are sent once and never shown again.
 */
export function ConnectionPanel(props: {
  integration: Integration;
  base: string;
  loc: (text: Localized) => string;
  /** Shown once, e.g. after the owner came back from the CRM's sign-in without finishing. */
  notice?: string | null;
  /** Called after connecting or disconnecting. */
  onChange: (connected: boolean) => Promise<void>;
}) {
  const { integration, base, loc, onChange } = props;
  const { t, language } = useI18n();
  const { connection, name } = integration;
  const working = connection?.status === "connected";
  const [editing, setEditing] = useState(!working);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(props.notice ?? null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const url = `${base}/integrations/${integration.id}`;
  const fmt = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });

  const fail = (err: unknown) => {
    if (err instanceof ApiError) {
      setFieldErrors(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
      setError(err.status === 403 ? t("addons.adminOnly") : err.message);
    } else setError(t("common.error"));
    setBusy(false);
  };

  async function connectWithKeys(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await api(url, { method: "PUT", body: { credentials: values } });
      setValues({});
      setEditing(false);
      await onChange(true);
      setBusy(false);
    } catch (err) {
      fail(err);
    }
  }

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const { url: target } = await api<{ url: string }>(`${url}/oauth`, { method: "POST" });
      window.location.assign(target);
    } catch (err) {
      fail(err);
    }
  }

  async function disconnect() {
    if (!window.confirm(t("integrations.disconnectConfirm", { name }))) return;
    setBusy(true);
    setError(null);
    try {
      await api(url, { method: "DELETE" });
      setEditing(true);
      await onChange(false);
      setBusy(false);
    } catch (err) {
      fail(err);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h5 className="font-medium">{t("integrations.title")}</h5>
        {working && (
          <span className="badge badge-accent">
            ✓ {t("integrations.connected", { name: connection.accountName ?? name })}
          </span>
        )}
      </div>

      {!integration.available ? (
        <p className="muted">{t("integrations.unavailable", { name })}</p>
      ) : (
        <>
          {connection?.status === "error" && (
            <p className="error" role="alert">
              {t("integrations.needsReconnect", { name })}
            </p>
          )}
          {!connection && <p className="muted">{t("integrations.notConnected")}</p>}
          {working && connection.lastError && (
            <p className="muted">{t("integrations.lastError", { error: connection.lastError })}</p>
          )}
          {working && connection.lastSuccessAt && (
            <p className="muted">
              {t("integrations.lastSent", { date: fmt.format(new Date(connection.lastSuccessAt)) })}
            </p>
          )}

          {integration.auth === "oauth2" ? (
            <div className="flex flex-wrap items-center gap-3">
              {!working && (
                <>
                  <button type="button" className="btn" disabled={busy} onClick={signIn}>
                    {t("integrations.connectWith", { name })}
                  </button>
                  <span className="muted text-xs">{t("integrations.signInHint", { name })}</span>
                </>
              )}
            </div>
          ) : editing ? (
            <form className="flex flex-col gap-3" onSubmit={connectWithKeys}>
              {integration.fields.map((field) => {
                const id = `integration-${integration.id}-${field.key}`;
                return (
                  <div key={field.key} className="flex flex-col gap-1">
                    <label htmlFor={id} className="font-medium">
                      {loc(field.label)}
                    </label>
                    <input
                      id={id}
                      className="input"
                      type={field.secret ? "password" : "text"}
                      autoComplete="off"
                      spellCheck={false}
                      dir="ltr"
                      required={field.required}
                      maxLength={field.maxLength}
                      placeholder={field.placeholder}
                      value={values[field.key] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                      aria-invalid={!!fieldErrors[field.key]}
                    />
                    {field.hint && <span className="muted text-xs">{loc(field.hint)}</span>}
                    {field.secret && <span className="muted text-xs">{t("integrations.secretHint")}</span>}
                    {fieldErrors[field.key] && (
                      <span className="error text-xs" role="alert">
                        {fieldErrors[field.key]}
                      </span>
                    )}
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn" type="submit" disabled={busy}>
                  {t("integrations.connect")}
                </button>
                {working && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => setEditing(false)}
                  >
                    {t("common.cancel")}
                  </button>
                )}
              </div>
            </form>
          ) : null}

          {connection && !editing && (
            <div className="flex flex-wrap items-center gap-3">
              {integration.auth === "fields" && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  {t("integrations.change")}
                </button>
              )}
              <button type="button" className="btn-text" disabled={busy} onClick={disconnect}>
                {t("integrations.disconnect")}
              </button>
            </div>
          )}
          {connection && editing && integration.auth === "oauth2" && (
            <button type="button" className="btn-text self-start" disabled={busy} onClick={disconnect}>
              {t("integrations.disconnect")}
            </button>
          )}
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
