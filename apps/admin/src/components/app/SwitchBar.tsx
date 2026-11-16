"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { enablePush, type PushState, type PushSupport, pushState, pushSupport } from "@/lib/push";

type Answering = { numbers: number; on: boolean; canChange: boolean; botId: string | null };

/** Told to every switch bar on the page when one changes something (the settings page listens). */
export const PAUSE_EVENT = "tb:notifications-paused";

/**
 * The two switches at the top of every owner-app screen (PLAN §20.2): notifications for me, and
 * whether the business's assistant answers calls and texts. Big, labelled, and colored by state,
 * so a tradesperson can see at a glance from a job site whether anything will reach them.
 */
export function SwitchBar({ tenantId }: { tenantId?: string | null }) {
  const { t } = useI18n();
  return (
    <section aria-label={t("switch.label")} className="mx-auto grid max-w-2xl grid-cols-2 gap-2 px-4 pb-3">
      <NotifySwitch />
      {tenantId ? <AnsweringSwitch tenantId={tenantId} /> : null}
    </section>
  );
}

function SwitchButton({
  icon,
  label,
  on,
  help,
  busy,
  disabled,
  stateText,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  on: boolean;
  help: string;
  busy: boolean;
  disabled?: boolean;
  /** Replaces On/Off (e.g. "No number yet"). */
  stateText?: string;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const tint = disabled
    ? "var(--surface)"
    : on
      ? "color-mix(in srgb, var(--status-good) 13%, var(--surface))"
      : "color-mix(in srgb, var(--danger) 11%, var(--surface))";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-busy={busy || undefined}
      aria-disabled={disabled || undefined}
      title={help}
      onClick={disabled || busy ? undefined : onToggle}
      className={`flex w-full flex-col items-start gap-2 rounded-2xl border p-3 text-start transition-colors ${
        disabled ? "cursor-default opacity-70" : "active:scale-[0.98]"
      }`}
      style={{
        background: tint,
        borderColor: disabled
          ? "var(--border)"
          : on
            ? "color-mix(in srgb, var(--status-good) 45%, var(--border))"
            : "color-mix(in srgb, var(--danger) 40%, var(--border))",
      }}
    >
      {/* Two rows so the label never gets cut off on a narrow phone, in English or French. */}
      <span className="flex items-center gap-2">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0"
        >
          {icon}
        </svg>
        <span className="min-w-0 text-sm leading-tight font-semibold">{label}</span>
      </span>
      <span className="flex items-center gap-2">
        {!stateText && (
          // The track: green with the knob at the end when on.
          <span
            aria-hidden="true"
            className="relative h-6 w-10 shrink-0 rounded-full transition-colors"
            style={{
              background: on ? "var(--status-good)" : "color-mix(in srgb, var(--muted) 45%, transparent)",
            }}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[inset-inline-start] ${
                on ? "start-[1.125rem]" : "start-0.5"
              } ${busy ? "animate-pulse" : ""}`}
            />
          </span>
        )}
        <span
          className={`text-sm leading-tight font-bold ${on || stateText ? "" : "text-[var(--danger)]"} ${
            stateText ? "muted font-medium" : ""
          }`}
        >
          {stateText ?? (on ? t("switch.on") : t("switch.off"))}
        </span>
      </span>
    </button>
  );
}

/**
 * On = not paused and this device is registered. Turning it on also asks for permission and
 * registers this phone when needed; turning it off pauses every device of mine (urgent included),
 * keeping the devices and choices for when it comes back on.
 */
function NotifySwitch() {
  const { t } = useI18n();
  const [paused, setPaused] = useState<boolean | null>(null);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [device, setDevice] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [prefs, found] = await Promise.all([
      api<{ prefs: { paused: boolean } }>("/v1/me/notification-prefs").catch(() => null),
      pushSupport().catch((): PushSupport => "unsupported"),
    ]);
    setPaused(prefs?.prefs.paused ?? false);
    setSupport(found);
    setDevice(found === "native" || found === "web" ? await pushState().catch((): PushState => "off") : null);
  }, []);

  useEffect(() => {
    void refresh();
    const again = () => void refresh();
    window.addEventListener(PAUSE_EVENT, again);
    return () => window.removeEventListener(PAUSE_EVENT, again);
  }, [refresh]);

  if (paused === null || support === null) return <Placeholder />;
  const canPush = support === "native" || support === "web";
  // Where this device can't get pushes (iPhone Safari, no Web Push), the switch is the pause alone.
  const on = !paused && (!canPush || device === "on");

  async function toggle() {
    setBusy(true);
    setMessage(null);
    try {
      if (on) {
        await api("/v1/me/notification-prefs", { method: "PATCH", body: { paused: true } });
        setPaused(true);
      } else {
        if (canPush && device !== "on") {
          const result = await enablePush({
            urgent: t("notify.channel.urgent"),
            requests: t("notify.channel.requests"),
          });
          setDevice(result);
          if (result !== "on") {
            setMessage(result === "denied" ? t("switch.denied") : t("switch.error"));
            return;
          }
        }
        await api("/v1/me/notification-prefs", { method: "PATCH", body: { paused: false } });
        setPaused(false);
      }
      window.dispatchEvent(new Event(PAUSE_EVENT));
    } catch {
      setMessage(t("switch.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <SwitchButton
        icon={
          on ? (
            <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9ZM10 19a2 2 0 0 0 4 0" />
          ) : (
            <path d="M6 9a6 6 0 0 1 9.6-4.8M18 9c0 5 2 6.5 2 6.5H8M10 19a2 2 0 0 0 4 0M3 3l18 18" />
          )
        }
        label={t("switch.notify")}
        on={on}
        help={on ? t("switch.notifyHelp.on") : t("switch.notifyHelp.off")}
        busy={busy}
        onToggle={toggle}
      />
      {message && (
        <p className="error text-xs" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

/** The business's assistant answering calls and texts on its number(s), or paused. */
function AnsweringSwitch({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<Answering | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setState(await api<Answering>(`/v1/tenants/${tenantId}/answering`).catch(() => null));
  }, [tenantId]);

  useEffect(() => {
    void refresh();
    // Someone else on the team may have changed it.
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  if (!state) return <Placeholder />;
  const phoneIcon = (
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
  );
  if (state.numbers === 0) {
    return (
      <SwitchButton
        icon={phoneIcon}
        label={t("switch.answering")}
        on={false}
        help={t("switch.noPhone")}
        busy={false}
        disabled
        stateText={t("switch.noPhone")}
        onToggle={() => undefined}
      />
    );
  }

  async function toggle() {
    if (!state) return;
    const next = !state.on;
    // Pausing turns customers away: a pocket tap shouldn't do it.
    if (!next && !window.confirm(t("switch.answeringConfirmOff"))) return;
    setBusy(true);
    setError(false);
    try {
      await api(`/v1/tenants/${tenantId}/answering`, { method: "PUT", body: { on: next } });
      setState({ ...state, on: next });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const help = !state.canChange
    ? t("switch.adminOnly")
    : state.on
      ? t("switch.answeringHelp.on")
      : t("switch.answeringHelp.off");
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <SwitchButton
        icon={phoneIcon}
        label={t("switch.answering")}
        on={state.on}
        help={help}
        busy={busy}
        disabled={!state.canChange}
        onToggle={toggle}
      />
      {error && (
        <p className="error text-xs" role="alert">
          {t("switch.error")}
        </p>
      )}
    </div>
  );
}

function Placeholder() {
  return (
    <div
      className="min-h-[4.75rem] rounded-2xl border border-[var(--border)] opacity-50"
      aria-hidden="true"
    />
  );
}
