"use client";

import type { MessageKey } from "@traiblazer/i18n";
import { useEffect, useState } from "react";
import { type Agency, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface Entry {
  id: string;
  action: string;
  tenantId: string | null;
  tenantName: string | null;
  createdAt: string;
  actor: string | null;
}

/** Actions with a translated label; anything else is shown as recorded. */
const KNOWN_ACTIONS = new Set([
  "agency.applied",
  "agency.active",
  "agency.suspended",
  "agency.declined",
  "agency.terms_updated",
  "client.created",
  "client.change",
  "client.suspended",
  "client.reactivated",
  "client.owner_added",
  "member.added",
  "member.removed",
  "branding.updated",
]);

/** What the agency's users did, and what we changed on the agency (newest first). */
export function AgencyActivity({ agency }: { agency: Agency }) {
  const { t, language } = useI18n();
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    api<{ entries: Entry[] }>(`/v1/agencies/${agency.id}/activity`)
      .then((data) => setEntries(data.entries))
      .catch(() => setEntries([]));
  }, [agency.id]);

  if (!entries) return <p className="muted">{t("common.loading")}</p>;
  if (entries.length === 0) return <p className="muted text-sm">{t("agency.activity.empty")}</p>;

  const label = (action: string) =>
    KNOWN_ACTIONS.has(action) ? t(`agency.activity.action.${action}` as MessageKey) : action;

  return (
    <ul className="card flex flex-col divide-y divide-[var(--border)] p-5">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm">
          <span>
            <span className="font-medium">{label(entry.action)}</span>
            {entry.tenantName && <span> · {entry.tenantName}</span>}
            {entry.actor && <span className="muted"> · {entry.actor}</span>}
          </span>
          <time className="muted text-xs" dateTime={entry.createdAt}>
            {new Date(entry.createdAt).toLocaleString(`${language}-CA`, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
        </li>
      ))}
    </ul>
  );
}
