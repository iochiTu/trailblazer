"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { CopyField } from "@/components/CopyField";
import { ApiError, api, type Pack } from "@/lib/api";
import { fmtNumber, type OperatorDemo } from "@/lib/operator";

const STATUS: Record<OperatorDemo["status"], { label: string; tone: "muted" | "ok" | "error" }> = {
  building: { label: "Building…", tone: "muted" },
  ready: { label: "Ready to review", tone: "ok" },
  needs_information: { label: "Nothing to read", tone: "error" },
  failed: { label: "Couldn't fill the page in", tone: "error" },
  handed_over: { label: "Handed over", tone: "muted" },
};

/** What went wrong, in words an operator can act on. */
function problem(demo: OperatorDemo): string | null {
  if (demo.status === "needs_information") {
    return "Nothing could be read from the sources (the website may block robots or be empty). Open Review & edit, add text or a price list on the Knowledge tab, then build again.";
  }
  if (demo.status === "failed") {
    return demo.error === "model_unavailable"
      ? "The AI model couldn't be reached. Build again in a moment."
      : "The setup assistant couldn't read the sources. Build again, or fill the page in by hand.";
  }
  return null;
}

/**
 * Prospect demos (PLAN §2.2): build a private demo page from a business's public information to
 * show at the first contact, see whether it was opened and used, then hand it over to the owner's
 * account when they sign up, or delete it.
 */
export function DemosTab() {
  const [demos, setDemos] = useState<OperatorDemo[] | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [pack, setPack] = useState("trades");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  /** Demo whose hand-over form is open. */
  const [handing, setHanding] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api<{ demos: OperatorDemo[] }>("/v1/operator/demos");
    setDemos(data.demos);
  }, []);

  useEffect(() => {
    void load().catch(() => setDemos([]));
    void api<{ available: Pack[] }>("/v1/catalog/packs")
      .then((data) => setPacks(data.available))
      .catch(() => {});
  }, [load]);

  // While a demo is being built, look again every few seconds.
  const building = demos?.some((d) => d.status === "building") ?? false;
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => void load().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [building, load]);

  const fail = (err: unknown) =>
    setMessage({
      kind: "error",
      text: err instanceof ApiError ? (err.issues[0]?.message ?? err.message) : "Couldn't save.",
    });

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    setBusy(true);
    setMessage(null);
    try {
      await api("/v1/operator/demos", {
        method: "POST",
        body: {
          businessName: text("businessName"),
          pack: text("pack"),
          variant: text("variant") || null,
          language: text("language"),
          websiteUrl: text("websiteUrl") || null,
          text: text("text") || null,
          note: text("note") || null,
        },
      });
      form.reset();
      setPack("trades");
      setMessage({ kind: "ok", text: "Building the demo page. This usually takes under a minute." });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function act(action: () => Promise<unknown>, done: string) {
    setMessage(null);
    try {
      await action();
      setMessage({ kind: "ok", text: done });
      await load();
    } catch (err) {
      fail(err);
    }
  }

  function remove(demo: OperatorDemo) {
    if (
      !window.confirm(`Delete the demo for ${demo.name}? Its page, sources and chats are removed for good.`)
    ) {
      return;
    }
    void act(
      () => api(`/v1/operator/demos/${demo.id}`, { method: "DELETE" }),
      `Demo for ${demo.name} deleted.`,
    );
  }

  function handOver(event: FormEvent<HTMLFormElement>, demo: OperatorDemo) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    void act(
      () => api(`/v1/operator/demos/${demo.id}/hand-over`, { method: "POST", body: { email } }),
      `${demo.name} now belongs to ${email}.`,
    ).then(() => setHanding(null));
  }

  const variants = packs.find((p) => p.slug === pack)?.variants ?? [];

  return (
    <div className="flex flex-col gap-4">
      <form className="card flex flex-col gap-4 p-5" onSubmit={create}>
        <div>
          <h2 className="text-lg font-medium">Build a demo page</h2>
          <p className="muted text-sm">
            For a business that isn't a customer yet, from its public information. The page gets a "demo"
            notice, is never listed by search engines, and only people with the link can open it. Nothing is
            put on it that isn't in the sources. Review it before you share the link.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Business name</span>
            <input className="input" name="businessName" required maxLength={120} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Industry</span>
              <select className="input" name="pack" value={pack} onChange={(e) => setPack(e.target.value)}>
                {packs.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Type</span>
              <select className="input" name="variant" key={pack}>
                <option value="">General</option>
                {variants.map((v) => (
                  <option key={v.slug} value={v.slug}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Website (optional)</span>
            <input className="input" name="websiteUrl" type="url" placeholder="https://www.example.com" />
            <span className="muted text-xs">
              Read like any website source: public pages only, robots.txt respected.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Page language</span>
            <select className="input" name="language" defaultValue="en">
              <option value="en">English</option>
              <option value="fr">French</option>
            </select>
            <span className="muted text-xs">The chat answers in both.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium">Public information (optional if there is a website)</span>
            <textarea
              className="input min-h-32"
              name="text"
              maxLength={50000}
              placeholder="Paste what the business publishes about itself: its Google listing (address, phone, hours, services), its Facebook page, a price list…"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium">Your note (optional, never shown on the page)</span>
            <input
              className="input"
              name="note"
              maxLength={500}
              placeholder="Who to contact, where the lead came from"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" type="submit" disabled={busy}>
            Build demo
          </button>
          {message && (
            <span className={message.kind === "error" ? "error text-sm" : "text-sm"} role="status">
              {message.text}
            </span>
          )}
        </div>
      </form>

      <div className="card flex flex-col gap-4 p-5">
        <h2 className="text-lg font-medium">Demos</h2>
        {!demos ? (
          <p className="muted">Loading…</p>
        ) : demos.length === 0 ? (
          <p className="muted text-sm">No demos yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {demos.map((demo) => {
              const status = STATUS[demo.status];
              const issue = problem(demo);
              const live = demo.status !== "handed_over";
              return (
                <li key={demo.id} className="panel flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-semibold">{demo.name}</span>
                    {demo.industry && <span className="muted text-sm">{demo.industry}</span>}
                    <span
                      className={
                        status.tone === "error"
                          ? "error text-sm font-medium"
                          : status.tone === "ok"
                            ? "text-sm font-medium"
                            : "muted text-sm"
                      }
                      style={status.tone === "ok" ? { color: "var(--accent)" } : undefined}
                      role="status"
                    >
                      {status.label}
                    </span>
                    <span className="muted ms-auto text-xs">
                      {new Date(demo.createdAt).toLocaleDateString("en-CA", { dateStyle: "medium" })}
                      {demo.createdBy ? ` · ${demo.createdBy}` : ""}
                    </span>
                  </div>

                  {demo.note && <p className="muted text-sm">{demo.note}</p>}
                  {issue && <p className="error text-sm">{issue}</p>}
                  {demo.status === "handed_over" && (
                    <p className="muted text-sm">
                      Belongs to {demo.handedOverTo} since{" "}
                      {demo.handedOverAt
                        ? new Date(demo.handedOverAt).toLocaleDateString("en-CA", { dateStyle: "medium" })
                        : "—"}
                      . Find it under Businesses.
                    </p>
                  )}

                  {live && (
                    <>
                      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                        {(
                          [
                            ["Services on the page", demo.services],
                            ["Page views", demo.views],
                            ["Chats", demo.conversations],
                            ["Requests", demo.requests],
                          ] as const
                        ).map(([label, value]) => (
                          <div key={label} className="flex gap-2">
                            <dt className="muted">{label}</dt>
                            <dd className="tabular-nums font-medium">{fmtNumber(value)}</dd>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <dt className="muted">Sources</dt>
                          <dd>
                            {demo.sources
                              .map((s) => `${s.type === "website" ? "website" : "text"} (${s.status})`)
                              .join(", ") || "none"}
                          </dd>
                        </div>
                      </dl>
                      {demo.pageUrl && demo.status !== "building" && (
                        <CopyField value={demo.pageUrl} label={`Demo link for ${demo.name}`} />
                      )}
                    </>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {live && demo.pageUrl && demo.status !== "building" && (
                      <a
                        className="btn btn-ghost px-3 py-1 text-sm"
                        href={demo.pageUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open page
                      </a>
                    )}
                    <Link
                      className="btn btn-ghost px-3 py-1 text-sm"
                      href={`/t/${demo.tenantId}/bots/${demo.botId}?tab=page`}
                    >
                      {live ? "Review & edit" : "Open business"}
                    </Link>
                    {live && demo.status !== "building" && (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost px-3 py-1 text-sm"
                          onClick={() =>
                            void act(
                              () => api(`/v1/operator/demos/${demo.id}/build`, { method: "POST" }),
                              `Building ${demo.name} again.`,
                            )
                          }
                        >
                          Build again
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost px-3 py-1 text-sm"
                          aria-expanded={handing === demo.id}
                          onClick={() => setHanding(handing === demo.id ? null : demo.id)}
                        >
                          Hand over…
                        </button>
                      </>
                    )}
                    {live && (
                      <button type="button" className="btn-text ms-auto text-sm" onClick={() => remove(demo)}>
                        Delete
                      </button>
                    )}
                  </div>

                  {handing === demo.id && (
                    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => handOver(e, demo)}>
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="font-medium">Owner's account email</span>
                        <input
                          className="input w-72"
                          name="email"
                          type="email"
                          required
                          placeholder="owner@example.com"
                        />
                      </label>
                      <button className="btn" type="submit">
                        Hand over
                      </button>
                      <span className="muted w-full text-xs">
                        The owner signs up first. They become the owner of this business, the demo notice
                        comes off the page, and it can be listed once they activate the assistant.
                      </span>
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
