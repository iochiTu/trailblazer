"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtNumber } from "@/lib/operator";

interface Detail {
  tenant: { id: string; name: string; plan: string; status: string; createdAt: string };
  members: { userId: string; name: string; email: string; role: string }[];
  assistants: {
    id: string;
    name: string;
    pack: string;
    status: "draft" | "active" | "paused";
    languages: string[];
    hostedPageEnabled: boolean;
    sources: number;
    conversations30d: number;
  }[];
}

const STATUS_LABEL = { draft: "Draft", active: "Live", paused: "Paused" } as const;

/** One business as staff see it: who manages it and its assistants, with support links. */
export function BusinessDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setDetail(null);
    setError(false);
    api<Detail>(`/v1/operator/tenants/${id}`)
      .then(setDetail)
      .catch(() => setError(true));
  }, [id]);

  return (
    <section
      className="card flex flex-col gap-4 p-5 ring-2 ring-[var(--accent-soft)] sm:p-7"
      aria-label="Business details"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">{detail?.tenant.name ?? "Business"}</h2>
          {detail && (
            <p className="muted text-sm">
              Plan {detail.tenant.plan} · {detail.tenant.status === "suspended" ? "Suspended" : "Active"} ·
              joined {new Date(detail.tenant.createdAt).toLocaleDateString("en-CA", { dateStyle: "medium" })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {detail && (
            <Link href={`/t/${id}/usage`} className="btn btn-ghost">
              Open usage
            </Link>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {error && <p className="error text-sm">Couldn't load this business.</p>}
      {!detail && !error && <p className="muted">Loading…</p>}

      {detail && (
        <>
          <p className="muted text-sm">
            Opening an assistant or the usage page uses support access: you can change settings like an admin
            of this business, and each change is recorded in the business's activity log.
          </p>

          <div className="flex flex-col gap-2">
            <h3 className="font-medium">People</h3>
            {detail.members.length === 0 ? (
              <p className="muted text-sm">No members.</p>
            ) : (
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
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="font-medium">Assistants</h3>
            {detail.assistants.length === 0 ? (
              <p className="muted text-sm">No assistants yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="muted text-left">
                    <tr>
                      <th className="py-2 pr-4 font-normal">Assistant</th>
                      <th className="py-2 pr-4 font-normal">Status</th>
                      <th className="py-2 pr-4 text-right font-normal">Sources</th>
                      <th className="py-2 pr-4 text-right font-normal">Conversations (30 days)</th>
                      <th className="py-2 font-normal">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.assistants.map((a) => (
                      <tr key={a.id} className="border-t border-[var(--border)] align-top">
                        <td className="py-2 pr-4">
                          <div className="font-medium">{a.name}</div>
                          <div className="muted text-xs">
                            {a.pack} · {a.languages.join(", ")}
                            {a.hostedPageEnabled ? " · web version on" : ""}
                          </div>
                        </td>
                        <td className="py-2 pr-4">{STATUS_LABEL[a.status]}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(a.sources)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(a.conversations30d)}</td>
                        <td className="py-2 text-right">
                          <Link href={`/t/${id}/bots/${a.id}`} className="btn btn-ghost px-2 py-1 text-xs">
                            Open assistant
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
