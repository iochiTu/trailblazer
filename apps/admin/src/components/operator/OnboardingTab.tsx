"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { OnboardingStepId, OperatorOnboarding, OperatorTenant } from "@/lib/operator";

type Step = OperatorOnboarding["steps"][number];

/** Each step's name and where in the assistant it is done. */
const STEPS: Record<OnboardingStepId, { label: string; tab?: string }> = {
  sources: { label: "Materials read", tab: "knowledge" },
  page: { label: "Page content: description, contact, hours", tab: "page" },
  services: { label: "Services and prices", tab: "page" },
  photos: { label: "Photos", tab: "knowledge" },
  review: { label: "Owner reviewed the page" },
  google: { label: "Link added to the Google Business Profile" },
  live: { label: "Page published", tab: "share" },
};

const MISSING: Record<OperatorOnboarding["facts"]["missing"][number], string> = {
  description: "description",
  contact: "phone or email",
  hours: "opening hours",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the business's data says about a step, or who marked it. */
function detail(step: Step, item: OperatorOnboarding): string | null {
  if (step.mark && step.state === step.mark.state) {
    const who = step.mark.by ? ` by ${step.mark.by}` : "";
    const verb = step.mark.state === "done" ? "Marked done" : "Marked not needed";
    return `${verb}${who}, ${fmtDate(step.mark.at)}`;
  }
  const { facts } = item;
  switch (step.id) {
    case "sources": {
      const { ready, failed, pending } = facts.sources;
      if (!ready && !failed && !pending) return "Nothing added yet: add the website, a document or text.";
      return [
        ready && `${plural(ready, "source")} read`,
        pending && `${pending} still reading`,
        failed && `${failed} couldn't be read`,
      ]
        .filter(Boolean)
        .join(", ");
    }
    case "page":
      return facts.missing.length ? `Missing: ${facts.missing.map((m) => MISSING[m]).join(", ")}` : null;
    case "services":
      return facts.services ? `${plural(facts.services, "service")} on the page` : "None on the page yet";
    case "photos":
      return facts.photos ? `${plural(facts.photos, "photo")}` : "None yet";
    case "review":
      return step.state === "open"
        ? "Send the owner the page link and tick this when they approve it."
        : null;
    case "google":
      return step.state === "open"
        ? "Add the page link as the website or booking link on the listing."
        : null;
    case "live":
      return facts.live ? "The assistant is active and the page is on" : null;
  }
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });

/** "3 hours", "2 days": rough enough for a deadline. */
function span(ms: number): string {
  const hours = Math.abs(ms) / 3_600_000;
  if (hours < 1) return "under an hour";
  if (hours < 48) return plural(Math.round(hours), "hour");
  return plural(Math.round(hours / 24), "day");
}

/** Where the checklist stands against its deadline. */
function timing(item: OperatorOnboarding, now: number): { text: string; late: boolean } {
  const due = new Date(item.dueAt).getTime();
  if (item.liveAt) {
    const late = new Date(item.liveAt).getTime() - due;
    return late > 0
      ? { text: `Live ${span(late)} late`, late: true }
      : { text: `Live on time, ${fmtDate(item.liveAt)}`, late: false };
  }
  return now > due
    ? { text: `Overdue by ${span(now - due)}`, late: true }
    : { text: `Due in ${span(due - now)} (${fmtDate(item.dueAt)})`, late: false };
}

/** A datetime-local value for an instant, in the browser's time zone. */
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/**
 * Done-for-you onboarding (PLAN §7): once a business sends its materials, its page is due one
 * working day later. Steps the business's data shows are ticked by themselves; staff tick the owner's
 * review and the Google listing, and publish the page once the owner approved it.
 */
export function OnboardingTab() {
  const [items, setItems] = useState<OperatorOnboarding[] | null>(null);
  const [businesses, setBusinesses] = useState<OperatorTenant[]>([]);
  const [business, setBusiness] = useState("");
  const [assistants, setAssistants] = useState<{ id: string; name: string }[]>([]);
  const [show, setShow] = useState<"open" | "finished">("open");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  /** Checklist whose "materials received" and note are being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const data = await api<{ onboardings: OperatorOnboarding[] }>("/v1/operator/onboardings");
    setItems(data.onboardings);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    void load().catch(() => setItems([]));
    void api<{ tenants: OperatorTenant[] }>("/v1/operator/tenants")
      .then((data) => setBusinesses(data.tenants))
      .catch(() => {});
    // Keeps "due in" current while the tab stays open.
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    setAssistants([]);
    if (!business) return;
    void api<{ assistants: { id: string; name: string }[] }>(`/v1/operator/tenants/${business}`)
      .then((data) => setAssistants(data.assistants))
      .catch(() => {});
  }, [business]);

  const fail = (err: unknown) =>
    setMessage({
      kind: "error",
      text: err instanceof ApiError ? (err.issues[0]?.message ?? err.message) : "Couldn't save.",
    });

  async function act(action: () => Promise<unknown>, done: string) {
    setMessage(null);
    try {
      await action();
      setMessage({ kind: "ok", text: done });
      await load();
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const received = text("receivedAt");
    setBusy(true);
    const name = businesses.find((b) => b.id === business)?.name ?? "the business";
    const ok = await act(
      () =>
        api("/v1/operator/onboardings", {
          method: "POST",
          body: {
            tenantId: business,
            botId: text("botId") || null,
            receivedAt: received ? new Date(received).toISOString() : null,
            note: text("note") || null,
          },
        }),
      `Checklist started for ${name}.`,
    );
    setBusy(false);
    if (ok) {
      form.reset();
      setBusiness("");
      setShow("open");
    }
  }

  const mark = (item: OperatorOnboarding, step: Step, state: "done" | "skipped" | "open") =>
    void act(
      () =>
        api(`/v1/operator/onboardings/${item.id}`, {
          method: "PATCH",
          body: { step: { id: step.id, state } },
        }),
      `${item.business}: "${STEPS[step.id].label}" ${
        state === "done" ? "done" : state === "skipped" ? "marked not needed" : "back on the list"
      }.`,
    );

  function edit(event: FormEvent<HTMLFormElement>, item: OperatorOnboarding) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const received = String(data.get("receivedAt") ?? "");
    void act(
      () =>
        api(`/v1/operator/onboardings/${item.id}`, {
          method: "PATCH",
          body: {
            ...(received ? { receivedAt: new Date(received).toISOString() } : {}),
            note: String(data.get("note") ?? "").trim() || null,
          },
        }),
      `${item.business} updated.`,
    ).then((ok) => ok && setEditing(null));
  }

  function publish(item: OperatorOnboarding) {
    if (!window.confirm(`Publish the page for ${item.business}? Visitors can open it and chat right away.`)) {
      return;
    }
    void act(
      () => api(`/v1/operator/onboardings/${item.id}/go-live`, { method: "POST" }),
      `${item.business} is live.`,
    );
  }

  function remove(item: OperatorOnboarding) {
    if (
      !window.confirm(
        `Remove the checklist for ${item.business}? The business and its page stay as they are.`,
      )
    ) {
      return;
    }
    void act(
      () => api(`/v1/operator/onboardings/${item.id}`, { method: "DELETE" }),
      `Checklist for ${item.business} removed.`,
    );
  }

  const started = new Set(items?.map((i) => i.tenantId));
  const available = businesses.filter((b) => !started.has(b.id));
  const shown = items?.filter((i) => (show === "finished") === i.finished) ?? [];
  const counts = {
    open: items?.filter((i) => !i.finished).length ?? 0,
    finished: items?.filter((i) => i.finished).length ?? 0,
  };

  return (
    <div className="flex flex-col gap-4">
      <form className="card flex flex-col gap-4 p-5" onSubmit={start}>
        <div>
          <h2 className="text-lg font-medium">Start an onboarding</h2>
          <p className="muted text-sm">
            For a business we set up ourselves. The page is due one working day after its materials arrived
            (Monday to Friday; materials sent on a weekend count from Monday 9:00).
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Business</span>
            <select className="input" value={business} onChange={(e) => setBusiness(e.target.value)} required>
              <option value="">Choose a business…</option>
              {available.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <span className="muted text-xs">
              Demos are handed over to the owner's account first (Demos tab).
            </span>
          </label>
          {assistants.length > 1 && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Assistant</span>
              <select className="input" name="botId">
                {assistants.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Materials received</span>
            <input
              className="input"
              name="receivedAt"
              type="datetime-local"
              defaultValue={localInput(new Date())}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium">Note (optional)</span>
            <input
              className="input"
              name="note"
              maxLength={500}
              placeholder="What they sent, who to call for the review"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" type="submit" disabled={busy || !business}>
            Start checklist
          </button>
          {message && (
            <span className={message.kind === "error" ? "error text-sm" : "text-sm"} role="status">
              {message.text}
            </span>
          )}
        </div>
      </form>

      <div className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-medium">Onboardings</h2>
          <fieldset className="ms-auto flex gap-1">
            <legend className="sr-only">Show</legend>
            {(
              [
                ["open", "In progress"],
                ["finished", "Finished"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`btn px-3 py-1 text-sm ${show === id ? "" : "btn-ghost"}`}
                aria-pressed={show === id}
                onClick={() => setShow(id)}
              >
                {label} ({counts[id]})
              </button>
            ))}
          </fieldset>
        </div>

        {!items ? (
          <p className="muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="muted text-sm">
            {show === "open" ? "Nothing in progress." : "No finished onboardings yet."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {shown.map((item) => {
              const when = timing(item, now);
              const done = item.steps.filter((s) => s.state !== "open").length;
              const reviewed = item.steps.find((s) => s.id === "review")?.state === "done";
              const base = `/t/${item.tenantId}/bots/${item.botId}`;
              return (
                <li key={item.id} className="panel flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-semibold">{item.business}</span>
                    <span className="muted text-sm">{item.assistant}</span>
                    {item.businessStatus === "suspended" && (
                      <span className="error text-sm font-medium">Suspended</span>
                    )}
                    <span className={when.late ? "error text-sm font-medium" : "text-sm font-medium"}>
                      {when.text}
                    </span>
                    <span className="muted ms-auto text-xs">
                      Received {fmtDate(item.receivedAt)}
                      {item.createdBy ? ` · ${item.createdBy}` : ""}
                    </span>
                  </div>

                  {item.note && <p className="muted text-sm">{item.note}</p>}

                  <div className="flex items-center gap-3 text-sm">
                    <progress
                      className="h-2 w-40 accent-[var(--accent)]"
                      value={done}
                      max={item.steps.length}
                      aria-label={`${item.business}: steps finished`}
                    />
                    <span className="tabular-nums">
                      {done} of {item.steps.length} steps
                    </span>
                  </div>

                  <ol className="flex flex-col divide-y divide-[var(--border)]">
                    {item.steps.map((step) => {
                      const { label, tab } = STEPS[step.id];
                      const info = detail(step, item);
                      const undoable = step.mark !== null && step.state === step.mark.state;
                      return (
                        <li key={step.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                          <span
                            aria-hidden="true"
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs ${
                              step.state === "done"
                                ? "bg-[var(--accent)] text-[var(--accent-text)]"
                                : step.state === "skipped"
                                  ? "border border-dashed border-[var(--muted)]"
                                  : "border-2 border-[var(--muted)]"
                            }`}
                          >
                            {step.state === "done" ? "✓" : step.state === "skipped" ? "–" : ""}
                          </span>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span
                              className={step.state === "skipped" ? "muted text-sm line-through" : "text-sm"}
                            >
                              {label}
                              <span className="sr-only">
                                {step.state === "done"
                                  ? ": done"
                                  : step.state === "skipped"
                                    ? ": not needed"
                                    : ": to do"}
                              </span>
                            </span>
                            {info && <span className="muted text-xs">{info}</span>}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {step.state === "open" && tab && (
                              <Link className="btn-text text-sm" href={`${base}?tab=${tab}`}>
                                Open
                              </Link>
                            )}
                            {step.id === "live" && step.state === "open" && (
                              <button
                                type="button"
                                className="btn px-3 py-1 text-sm"
                                disabled={!reviewed}
                                title={reviewed ? undefined : "Mark the owner's review done first"}
                                onClick={() => publish(item)}
                              >
                                Publish page
                              </button>
                            )}
                            {step.state === "open" && step.manual && (
                              <button
                                type="button"
                                className="btn btn-ghost px-3 py-1 text-sm"
                                onClick={() => mark(item, step, "done")}
                              >
                                Mark done
                              </button>
                            )}
                            {step.state === "open" && step.id !== "live" && (
                              <button
                                type="button"
                                className="btn-text text-sm"
                                onClick={() => mark(item, step, "skipped")}
                              >
                                Not needed
                              </button>
                            )}
                            {undoable && (
                              <button
                                type="button"
                                className="btn-text text-sm"
                                onClick={() => mark(item, step, "open")}
                              >
                                Undo
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>

                  <div className="flex flex-wrap items-center gap-2">
                    {item.pageUrl && (
                      <a
                        className="btn btn-ghost px-3 py-1 text-sm"
                        href={item.pageUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open page
                      </a>
                    )}
                    <Link className="btn btn-ghost px-3 py-1 text-sm" href={base}>
                      Open assistant
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost px-3 py-1 text-sm"
                      aria-expanded={editing === item.id}
                      onClick={() => setEditing(editing === item.id ? null : item.id)}
                    >
                      Edit…
                    </button>
                    <button type="button" className="btn-text ms-auto text-sm" onClick={() => remove(item)}>
                      Remove
                    </button>
                  </div>

                  {editing === item.id && (
                    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => edit(e, item)}>
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="font-medium">Materials received</span>
                        <input
                          className="input"
                          name="receivedAt"
                          type="datetime-local"
                          defaultValue={localInput(new Date(item.receivedAt))}
                        />
                      </label>
                      <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm">
                        <span className="font-medium">Note</span>
                        <input className="input" name="note" maxLength={500} defaultValue={item.note ?? ""} />
                      </label>
                      <button className="btn" type="submit">
                        Save
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
