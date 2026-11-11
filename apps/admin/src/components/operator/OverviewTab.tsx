"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtNumber, fmtUsd, type OperatorOverview, type OperatorPlan } from "@/lib/operator";

function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="muted text-sm">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {note && <span className="muted text-xs">{note}</span>}
    </div>
  );
}

export function OverviewTab() {
  const [data, setData] = useState<{ overview: OperatorOverview; plans: OperatorPlan[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      api<OperatorOverview>("/v1/operator/overview"),
      api<{ plans: OperatorPlan[] }>("/v1/operator/plans"),
    ])
      .then(([overview, { plans }]) => setData({ overview, plans }))
      .catch(() => setError(true));
  }, []);

  if (error) return <p className="error">Couldn't load the overview.</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { overview, plans } = data;
  const month = new Date(`${overview.period}-01T12:00:00`).toLocaleDateString("en-CA", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile
          label="Businesses"
          value={fmtNumber(overview.businesses)}
          note={overview.suspended ? `${fmtNumber(overview.suspended)} suspended` : "None suspended"}
        />
        <StatTile
          label="Assistants"
          value={fmtNumber(overview.assistants)}
          note={`${fmtNumber(overview.activeAssistants)} live`}
        />
        <StatTile label="Questions" value={fmtNumber(overview.questions)} note={month} />
        <StatTile label="Refused by limits" value={fmtNumber(overview.refused)} note={month} />
        <StatTile label="AI cost" value={fmtUsd(overview.costMicros)} note={month} />
      </div>
      {overview.demos > 0 && (
        <p className="muted text-sm">
          Plus {fmtNumber(overview.demos)} prospect {overview.demos === 1 ? "demo" : "demos"}, not counted
          above ({fmtUsd(overview.demoCostMicros)} AI cost this month).
        </p>
      )}

      <div className="card overflow-x-auto p-5">
        <h2 className="mb-3 text-lg font-medium">Businesses by plan</h2>
        <table className="w-full text-sm">
          <thead className="muted text-left">
            <tr>
              <th className="py-2 pr-4 font-normal">Plan</th>
              <th className="py-2 pr-4 text-right font-normal">Businesses</th>
              <th className="py-2 text-right font-normal">Share</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => {
              const count = overview.byPlan[p.id] ?? 0;
              return (
                <tr key={p.id} className="border-t border-[var(--border)]">
                  <td className="py-2 pr-4">
                    {p.nameEn} {!p.active && <span className="muted">(archived)</span>}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(count)}</td>
                  <td className="muted py-2 text-right tabular-nums">
                    {overview.businesses ? `${Math.round((count / overview.businesses) * 100)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
