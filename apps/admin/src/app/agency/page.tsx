"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AgencyActivity } from "@/components/agency/AgencyActivity";
import { AgencyApply } from "@/components/agency/AgencyApply";
import { AgencyBranding } from "@/components/agency/AgencyBranding";
import { AgencyClients } from "@/components/agency/AgencyClients";
import { AgencyOverview } from "@/components/agency/AgencyOverview";
import { AgencyTeam } from "@/components/agency/AgencyTeam";
import { ConsoleShell, type SubNavGroup } from "@/components/app/SideNav";
import { ScrollTabs } from "@/components/ScrollTabs";
import { type Agency, ApiError, api, type Me } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Tab = "overview" | "clients" | "team" | "branding" | "activity";

/**
 * The agency panel (docs/AGENCY.md §3.2): a partner agency's clients, team and branding. A user
 * without an agency sees the partner application instead.
 */
export default function AgencyPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [agency, setAgency] = useState<Agency | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [tab, setTab] = useState<Tab>("overview");

  const load = useCallback(async () => {
    try {
      const data = await api<Me>("/v1/auth/me");
      // Staff accounts never belong to an agency; their place is the operator console.
      if (data.user.platformRole) {
        router.replace("/operator");
        return;
      }
      setMe(data);
      const first = data.agencies[0];
      setAgency(first ? (await api<{ agency: Agency }>(`/v1/agencies/${first.id}`)).agency : null);
      setState("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/login");
      else setState("error");
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === "loading") return <p className="muted p-8">{t("common.loading")}</p>;
  if (state === "error" || !me) return <p className="error p-8">{t("common.error")}</p>;

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: t("agency.tab.overview") },
    { id: "clients", label: t("agency.tab.clients") },
    { id: "team", label: t("agency.tab.team") },
    { id: "branding", label: t("agency.tab.branding") },
    ...(agency && agency.role !== "member"
      ? [{ id: "activity" as const, label: t("agency.tab.activity") }]
      : []),
  ];
  const groups: SubNavGroup<Tab>[] = [{ id: "agency", items: tabs }];

  if (!agency || agency.status === "declined") {
    return (
      <ConsoleShell active="agency">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
          {agency?.status === "declined" && (
            <p className="panel px-4 py-3 text-sm" role="note">
              {t("agency.declined.body")}
            </p>
          )}
          <AgencyApply onApplied={load} />
        </div>
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell
      sub={{
        label: t("agency.title"),
        title: agency.name,
        note: t(`agency.status.${agency.status}`),
        back: { href: "/dashboard", label: t("nav.bots") },
        groups,
        selected: tab,
        onSelect: setTab,
      }}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow">{agency.name}</p>
            <h1 className="mt-1 text-2xl font-semibold">{tabs.find((item) => item.id === tab)?.label}</h1>
          </div>
          <span className={agency.status === "active" ? "badge badge-accent" : "badge"}>
            {t(`agency.status.${agency.status}`)}
          </span>
        </header>

        {agency.status === "applied" && (
          <p className="panel px-4 py-3 text-sm" role="note">
            {t("agency.applied.body")}
          </p>
        )}
        {agency.status === "suspended" && (
          <p className="panel px-4 py-3 text-sm" role="alert">
            {t("agency.suspended.body")}
          </p>
        )}

        {/* Phone: the tabs in a row. A wide screen has them in the sidebar instead. */}
        <div className="lg:hidden">
          <ScrollTabs selectedKey={tab} label={t("agency.title")}>
            {tabs.map(({ id, label }) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={tab === id}
                className="tab"
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </ScrollTabs>
        </div>

        <section role="tabpanel">
          {tab === "overview" && <AgencyOverview agency={agency} />}
          {tab === "clients" && <AgencyClients agency={agency} />}
          {tab === "team" && <AgencyTeam agency={agency} me={me.user.id} />}
          {tab === "branding" && <AgencyBranding agency={agency} onSaved={setAgency} />}
          {tab === "activity" && <AgencyActivity agency={agency} />}
        </section>
      </div>
    </ConsoleShell>
  );
}
