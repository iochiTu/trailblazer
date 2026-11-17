"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { fmtNumber, fmtUsd, type OperatorPlan, type OperatorTenant } from "@/lib/operator";
import { BusinessDetail } from "./BusinessDetail";

export function BusinessesTab({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (tenantId: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [tenants, setTenants] = useState<OperatorTenant[] | null>(null);
  const [plans, setPlans] = useState<OperatorPlan[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async (q: string) => {
    const [list, planList] = await Promise.all([
      api<{ tenants: OperatorTenant[] }>(`/v1/operator/tenants?q=${encodeURIComponent(q)}`),
      api<{ plans: OperatorPlan[] }>("/v1/operator/plans"),
    ]);
    setTenants(list.tenants);
    setPlans(planList.plans);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(query).catch(() => setTenants([])), 250);
    return () => clearTimeout(timer);
  }, [load, query]);

  async function update(tenant: OperatorTenant, body: { plan?: string; status?: "active" | "suspended" }) {
    if (
      body.status === "suspended" &&
      !window.confirm(`Suspend ${tenant.name}? All of its assistants go offline until reactivated.`)
    ) {
      return;
    }
    setMessage(null);
    try {
      await api(`/v1/operator/tenants/${tenant.id}`, { method: "PATCH", body });
      setMessage({
        kind: "ok",
        text: body.plan
          ? `${tenant.name} moved to ${plans.find((p) => p.id === body.plan)?.nameEn ?? body.plan}.`
          : `${tenant.name} ${body.status === "suspended" ? "suspended" : "reactivated"}.`,
      });
      await load(query);
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Couldn't save." });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {selected && <BusinessDetail id={selected} onClose={() => onSelect(null)} />}
      <div className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Businesses</h2>
          <input
            className="input max-w-xs"
            type="search"
            placeholder="Search name, owner email or agency"
            aria-label="Search businesses"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {message && (
          <p className={message.kind === "error" ? "error text-sm" : "text-sm"} role="status">
            {message.text}
          </p>
        )}
        {!tenants ? (
          <p className="muted">Loading…</p>
        ) : tenants.length === 0 ? (
          <p className="muted text-sm">No businesses match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="muted text-left">
                <tr>
                  <th className="py-2 pr-4 font-normal">Business</th>
                  <th className="py-2 pr-4 font-normal">Plan</th>
                  <th className="py-2 pr-4 text-right font-normal">Questions this month</th>
                  <th className="py-2 pr-4 text-right font-normal">Assistants</th>
                  <th className="py-2 pr-4 text-right font-normal">AI cost</th>
                  <th className="py-2 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => {
                  const choices = plans.filter((p) => p.active || p.id === t.plan);
                  return (
                    <tr key={t.id} className="border-t border-[var(--border)] align-top">
                      <td className="py-3 pr-4">
                        <button
                          type="button"
                          className="text-left font-medium underline-offset-4 hover:underline"
                          aria-expanded={selected === t.id}
                          onClick={() => onSelect(t.id)}
                        >
                          {t.name}
                        </button>
                        <div className="muted text-xs">{t.owners.join(", ") || "No owner"}</div>
                        {t.agency && (
                          <div className="text-xs">
                            Agency: {t.agency.name} ·{" "}
                            {t.billingMode === "agency_pays" ? "agency pays" : "client pays"}
                          </div>
                        )}
                        <div className="muted text-xs">
                          Joined {new Date(t.createdAt).toLocaleDateString("en-CA", { dateStyle: "medium" })}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <select
                          className="input"
                          aria-label={`Plan for ${t.name}`}
                          value={t.plan}
                          onChange={(e) => void update(t, { plan: e.target.value })}
                        >
                          {choices.map((p) => (
                            <option key={p.id} value={p.id} disabled={!p.active}>
                              {p.nameEn}
                              {p.active ? "" : " (archived)"}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {fmtNumber(t.questions)} / {fmtNumber(t.monthlyLimit)}
                        {t.refused > 0 && <div className="muted text-xs">{fmtNumber(t.refused)} refused</div>}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {fmtNumber(t.assistants)}
                        <div className="muted text-xs">{fmtNumber(t.activeAssistants)} live</div>
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">{fmtUsd(t.costMicros)}</td>
                      <td className="py-3">
                        <div className="flex flex-col items-start gap-2">
                          <span
                            className={t.status === "suspended" ? "error text-xs font-medium" : "text-xs"}
                          >
                            {t.status === "suspended" ? "⛔ Suspended" : "Active"}
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost px-2 py-1 text-xs"
                            onClick={() =>
                              void update(t, { status: t.status === "suspended" ? "active" : "suspended" })
                            }
                          >
                            {t.status === "suspended" ? "Reactivate" : "Suspend"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
