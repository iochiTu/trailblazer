"use client";

import { useState } from "react";
import { ApiError, api, type InboxLead, type Lead } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Action = NonNullable<Lead["nextAction"]>;

export function NextActionSummary({ action }: { action: Action | null }) {
  const { t, language } = useI18n();
  if (!action) return <span className="badge badge-accent">{t("request.needsReview")}</span>;
  return (
    <span className="flex flex-col gap-1 text-sm">
      <span dir="auto">{action.text}</span>
      <span className="muted text-xs">
        {t(`request.waitingOn.${action.waitingOn}`)}
        {action.dueAt && (
          <>
            {" "}
            ·{" "}
            <time dateTime={action.dueAt}>
              {t("request.reminderAt", {
                time: new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(
                  new Date(action.dueAt),
                ),
              })}
            </time>
          </>
        )}
      </span>
    </span>
  );
}

function localInput(instant?: string | null) {
  if (!instant) return "";
  const date = new Date(instant);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function RequestNextAction({
  lead,
  url,
  canEdit,
  reload,
}: {
  lead: InboxLead;
  url: string;
  canEdit: boolean;
  reload: () => Promise<void>;
}) {
  const { t } = useI18n();
  const current = lead.nextAction;
  const [editing, setEditing] = useState(!current);
  const [text, setText] = useState(current?.text ?? "");
  const [waitingOn, setWaitingOn] = useState<Action["waitingOn"]>(current?.waitingOn ?? "business");
  const [due, setDue] = useState(localInput(current?.dueAt));
  const [suggestion, setSuggestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function suggest() {
    setBusy(true);
    setError("");
    setSuggestion("");
    try {
      const data = await api<{ suggestion: string | null }>(`${url}/suggestion`, { method: "POST" });
      if (data.suggestion) setSuggestion(data.suggestion);
      else setError(t("request.noSuggestion"));
    } catch {
      setError(t("request.noSuggestion"));
    } finally {
      setBusy(false);
    }
  }

  async function save(action: Action | null) {
    setBusy(true);
    setError("");
    try {
      await api(url, { method: "PUT", body: { action, version: lead.actionVersion } });
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        window.alert(t("request.actionChanged"));
        await reload();
      } else setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card flex flex-col gap-3 p-5" aria-labelledby="next-action-title">
      <h2 id="next-action-title" className="font-semibold">
        {t("request.nextAction")}
      </h2>
      <div>
        <NextActionSummary action={current} />
      </div>
      {canEdit &&
        (editing ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ text: text.trim(), waitingOn, dueAt: due ? new Date(due).toISOString() : null });
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              {t("request.actionText")}
              <input
                className="input"
                dir="auto"
                required
                maxLength={300}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <div>
              <button type="button" className="btn-text" disabled={busy} onClick={suggest}>
                {t("request.suggest")}
              </button>
            </div>
            {suggestion && (
              <div className="panel flex flex-col items-start gap-2 p-3" role="status">
                <strong className="text-xs">{t("request.aiSuggestion")}</strong>
                <p dir="auto">{suggestion}</p>
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => {
                    setText(suggestion);
                    setSuggestion("");
                  }}
                >
                  {t("request.useDraft")}
                </button>
              </div>
            )}
            <label className="flex flex-col gap-1 text-sm">
              {t("request.waitingOn")}
              <select
                className="input"
                value={waitingOn}
                onChange={(e) => setWaitingOn(e.target.value as Action["waitingOn"])}
              >
                <option value="business">{t("request.waitingOn.business")}</option>
                <option value="customer">{t("request.waitingOn.customer")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("request.remindTeam")}
              <input
                className="input"
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="btn" type="submit" disabled={busy || !text.trim()}>
                {t("request.saveAction")}
              </button>
              {current && (
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  {t("common.cancel")}
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                setText(current?.text ?? "");
                setWaitingOn(current?.waitingOn ?? "business");
                setDue(localInput(current?.dueAt));
                setSuggestion("");
                setError("");
                setEditing(true);
              }}
            >
              {t("request.editAction")}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void save(null)}>
              {t("request.finishStep")}
            </button>
          </div>
        ))}
      {error && (
        <p role="alert" className="error text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
