"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AuditEntry } from "@/lib/operator";

const ACTION_LABELS: Record<string, string> = {
  "plan.created": "Created plan",
  "plan.updated": "Edited plan",
  "tenant.updated": "Changed business",
  "policies.updated": "Changed policies",
  "support.change": "Support change",
};

const FIELD_LABELS: Record<string, string> = {
  plan: "Plan",
  status: "Status",
  nameEn: "Name (English)",
  nameFr: "Name (French)",
  monthlyQuestions: "Questions / month",
  perMinute: "Questions / minute",
  concurrent: "Answers at once",
  priceMonthlyCents: "Price (cents)",
  setupFeeCents: "Setup fee (cents)",
  active: "Assignable",
  sortOrder: "Sort order",
  defaultPlan: "Default plan",
  visitorDailyLimit: "Questions per visitor per day",
  conversationMaxQuestions: "Questions per conversation",
  chatIpPerMinute: "Chat messages per IP per minute",
  releasedPackPhase: "Industries available (phase)",
};
const label = (k: string) => FIELD_LABELS[k] ?? k;

const show = (v: unknown) =>
  v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

/** One line per changed field: "field: before → after". */
function describe(entry: AuditEntry): string[] {
  const m = entry.metadata;
  if (entry.action === "tenant.updated") {
    const from = (m.from ?? {}) as Record<string, unknown>;
    const to = (m.to ?? {}) as Record<string, unknown>;
    return Object.keys(to).map((k) => `${label(k)}: ${show(from[k])} → ${show(to[k])}`);
  }
  if (entry.action === "support.change") {
    return [`${show(m.method)} ${show(m.route)}`];
  }
  if (entry.action === "plan.created") {
    return [`${show(m.nameEn)}: ${show(m.monthlyQuestions)} questions/mo`];
  }
  return Object.entries(m).map(([k, v]) => {
    const change = v as { from?: unknown; to?: unknown };
    return `${label(k)}: ${show(change?.from)} → ${show(change?.to)}`;
  });
}

export function ActivityTab() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      api<{ entries: AuditEntry[] }>("/v1/operator/audit"),
      api<{ tenants: { id: string; name: string }[] }>("/v1/operator/tenants"),
    ])
      .then(([audit, list]) => {
        setEntries(audit.entries);
        setNames(Object.fromEntries(list.tenants.map((t) => [t.id, t.name])));
      })
      .catch(() => setEntries([]));
  }, []);

  if (!entries) return <p className="muted">Loading…</p>;

  return (
    <div className="card flex flex-col gap-3 p-5">
      <h2 className="text-lg font-medium">Recent operator changes</h2>
      {entries.length === 0 ? (
        <p className="muted text-sm">No changes yet.</p>
      ) : (
        <ul className="flex flex-col">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--border)] py-3 text-sm"
            >
              <time className="muted w-44 shrink-0 tabular-nums" dateTime={e.createdAt}>
                {new Date(e.createdAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
              </time>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span>
                  <span className="font-medium">{ACTION_LABELS[e.action] ?? e.action}</span>
                  {e.targetType === "tenant" && e.targetId && ` · ${names[e.targetId] ?? "Deleted business"}`}
                  {e.targetType === "plan" && ` · ${e.targetId}`}
                  <span className="muted"> by {e.actor ?? "deleted user"}</span>
                </span>
                {describe(e).map((line) => (
                  <span key={line} className="muted break-all text-xs">
                    {line}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
