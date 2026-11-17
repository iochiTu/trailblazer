"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { fmtNumber, type OperatorAgency } from "@/lib/operator";

type Status = OperatorAgency["status"];
type Mode = OperatorAgency["billingModes"][number];

interface AgencyDetail {
  members: { userId: string; name: string; email: string; role: string }[];
  clients: { id: string; name: string; plan: string; status: string; billingMode: Mode; createdAt: string }[];
}

const STATUS_LABEL: Record<Status, string> = {
  applied: "Applied",
  active: "Active",
  suspended: "Suspended",
  declined: "Declined",
};

const MODE_LABEL: Record<Mode, string> = {
  client_pays: "Client pays",
  agency_pays: "Agency pays (wholesale)",
};

/**
 * Partner agencies (docs/AGENCY.md §8): approve or decline applications, set each agency's terms
 * (currency, our percentage, billing modes, trial cap), suspend, hold payouts. Staff only.
 */
export function AgenciesTab({ onOpenBusiness }: { onOpenBusiness: (tenantId: string) => void }) {
  const [agencies, setAgencies] = useState<OperatorAgency[] | null>(null);
  const [defaultShare, setDefaultShare] = useState(30);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const data = await api<{ agencies: OperatorAgency[]; defaultSharePercent: number }>(
      "/v1/operator/agencies",
    );
    setAgencies(data.agencies);
    setDefaultShare(data.defaultSharePercent);
  }, []);

  useEffect(() => {
    load().catch(() => setAgencies([]));
  }, [load]);

  async function update(agency: OperatorAgency, body: Record<string, unknown>, done: string) {
    setMessage(null);
    try {
      await api(`/v1/operator/agencies/${agency.id}`, { method: "PATCH", body });
      setMessage({ kind: "ok", text: done });
      await load();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Couldn't save." });
    }
  }

  const shown = (agencies ?? []).filter((a) => filter === "all" || a.status === filter);
  const waiting = (agencies ?? []).filter((a) => a.status === "applied").length;

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">
          Agencies {waiting > 0 && <span className="badge badge-accent ml-2">{waiting} waiting</span>}
        </h2>
        <select
          className="input max-w-[12rem]"
          aria-label="Show agencies"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Status | "all")}
        >
          <option value="all">All agencies</option>
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      {message && (
        <p className={message.kind === "error" ? "error text-sm" : "text-sm"} role="status">
          {message.text}
        </p>
      )}
      {!agencies ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted text-sm">No agencies.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {shown.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <button
                    type="button"
                    className="text-left font-medium underline-offset-4 hover:underline"
                    aria-expanded={open === a.id}
                    onClick={() => setOpen(open === a.id ? null : a.id)}
                  >
                    {a.name}
                  </button>
                  <div className="muted text-xs">
                    {a.owners.join(", ") || "No owner"} · {a.country ?? "—"} · {a.currency.toUpperCase()} ·{" "}
                    {fmtNumber(a.clients)} {a.clients === 1 ? "client" : "clients"}
                  </div>
                  <div className="muted text-xs">
                    Applied {new Date(a.createdAt).toLocaleDateString("en-CA", { dateStyle: "medium" })}
                    {a.website && (
                      <>
                        {" · "}
                        <a href={a.website} className="underline" target="_blank" rel="noopener noreferrer">
                          {a.website}
                        </a>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={a.status === "applied" ? "badge badge-accent" : "badge"}>
                    {STATUS_LABEL[a.status]}
                  </span>
                  {a.payoutsHeld && <span className="badge">Payouts held</span>}
                  {a.status === "applied" && (
                    <>
                      <button
                        type="button"
                        className="btn px-3 py-1 text-xs"
                        onClick={() => void update(a, { status: "active" }, `${a.name} approved.`)}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost px-3 py-1 text-xs"
                        onClick={() =>
                          window.confirm(`Decline ${a.name}'s application?`) &&
                          void update(a, { status: "declined" }, `${a.name} declined.`)
                        }
                      >
                        Decline
                      </button>
                    </>
                  )}
                  {a.status === "active" && (
                    <button
                      type="button"
                      className="btn btn-ghost px-3 py-1 text-xs"
                      onClick={() =>
                        window.confirm(
                          `Suspend ${a.name}? Its users lose access to the panel and to every client. Clients keep running.`,
                        ) && void update(a, { status: "suspended" }, `${a.name} suspended.`)
                      }
                    >
                      Suspend
                    </button>
                  )}
                  {a.status === "suspended" && (
                    <button
                      type="button"
                      className="btn btn-ghost px-3 py-1 text-xs"
                      onClick={() => void update(a, { status: "active" }, `${a.name} reactivated.`)}
                    >
                      Reactivate
                    </button>
                  )}
                </div>
              </div>
              {a.applicationNote && (
                <p className="panel whitespace-pre-line px-4 py-3 text-sm" dir="auto">
                  {a.applicationNote}
                </p>
              )}
              {open === a.id && (
                <AgencyTerms
                  agency={a}
                  defaultShare={defaultShare}
                  onSave={(body) => update(a, body, `${a.name}'s terms saved.`)}
                  onOpenBusiness={onOpenBusiness}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgencyTerms({
  agency,
  defaultShare,
  onSave,
  onOpenBusiness,
}: {
  agency: OperatorAgency;
  defaultShare: number;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onOpenBusiness: (tenantId: string) => void;
}) {
  const [detail, setDetail] = useState<AgencyDetail | null>(null);
  const [modes, setModes] = useState<Mode[]>(agency.billingModes);

  useEffect(() => {
    api<AgencyDetail>(`/v1/operator/agencies/${agency.id}`)
      .then(setDetail)
      .catch(() => setDetail({ members: [], clients: [] }));
  }, [agency.id]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const share = String(data.get("sharePercent") ?? "").trim();
    const body: Record<string, unknown> = {
      sharePercent: share === "" ? null : Number(share),
      trialClientCap: Number(data.get("trialClientCap")),
      billingModes: modes,
      payoutsHeld: data.get("payoutsHeld") === "on",
    };
    const currency = String(data.get("currency") ?? "")
      .trim()
      .toLowerCase();
    if (currency !== agency.currency) body.currency = currency;
    void onSave(body);
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-[var(--surface-2)] p-4">
      <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={onSubmit}>
        <label className="flex flex-col gap-1 text-sm">
          Currency
          <input
            className="input uppercase"
            name="currency"
            required
            pattern="[A-Za-z]{3}"
            maxLength={3}
            defaultValue={agency.currency.toUpperCase()}
            disabled={agency.clients > 0}
          />
          {agency.clients > 0 && <span className="muted text-xs">Fixed once it has clients.</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Our share (%)
          <input
            className="input"
            type="number"
            name="sharePercent"
            min={0}
            max={100}
            placeholder={`Default (${defaultShare})`}
            defaultValue={agency.sharePercent ?? ""}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Clients on trial at once
          <input
            className="input"
            type="number"
            name="trialClientCap"
            required
            min={0}
            max={10000}
            defaultValue={agency.trialClientCap}
          />
        </label>
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1">Billing modes</legend>
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={modes.includes(m)}
                onChange={(e) =>
                  setModes((was) => (e.target.checked ? [...was, m] : was.filter((x) => x !== m)))
                }
              />
              {MODE_LABEL[m]}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="payoutsHeld" defaultChecked={agency.payoutsHeld} />
          Hold this agency's payouts
        </label>
        <div className="sm:col-span-2 lg:col-span-4">
          <button className="btn" type="submit" disabled={modes.length === 0}>
            Save terms
          </button>
        </div>
      </form>

      {!detail ? (
        <p className="muted text-sm">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium">Team</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {detail.members.map((m) => (
                <li key={m.userId}>
                  {m.name}{" "}
                  <span className="muted">
                    · {m.email} · {m.role}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">Clients</h3>
            {detail.clients.length === 0 ? (
              <p className="muted text-sm">None yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {detail.clients.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="underline-offset-4 hover:underline"
                      onClick={() => onOpenBusiness(c.id)}
                    >
                      {c.name}
                    </button>{" "}
                    <span className="muted">
                      · {c.plan} · {MODE_LABEL[c.billingMode]}
                      {c.status === "suspended" ? " · suspended" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
