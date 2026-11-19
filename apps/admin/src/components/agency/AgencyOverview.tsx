"use client";

import { useEffect, useState } from "react";
import { StatTile } from "@/components/StatTile";
import { type Agency, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface Overview {
  period: string;
  clients: number;
  suspended: number;
  trial: number;
  clientPays: number;
  agencyPays: number;
  byPlan: Record<string, number>;
  questions: number;
  activeAssistants: number;
}

export function AgencyOverview({ agency }: { agency: Agency }) {
  const { t, language } = useI18n();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api<Overview>(`/v1/agencies/${agency.id}/overview`)
      .then(setData)
      .catch(() => setError(true));
  }, [agency.id]);

  if (error) return <p className="error">{t("common.error")}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const num = (n: number) => new Intl.NumberFormat(`${language}-CA`).format(n);
  const month = new Date(`${data.period}-01T12:00:00`).toLocaleDateString(`${language}-CA`, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label={t("agency.overview.clients")}
          value={num(data.clients)}
          note={data.suspended ? t("agency.overview.suspended", { count: data.suspended }) : undefined}
        />
        <StatTile
          label={t("agency.overview.trial")}
          value={num(data.trial)}
          note={t("agency.overview.trialCap", { cap: agency.trialClientCap })}
        />
        <StatTile label={t("agency.overview.clientPays")} value={num(data.clientPays)} />
        <StatTile label={t("agency.overview.agencyPays")} value={num(data.agencyPays)} />
        <StatTile
          label={t("agency.overview.questions")}
          value={num(data.questions)}
          note={`${month} · ${t("agency.overview.assistants", { count: data.activeAssistants })}`}
        />
      </div>
      <p className="muted text-sm">{t("agency.overview.billingSoon")}</p>
    </div>
  );
}
