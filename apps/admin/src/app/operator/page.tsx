"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConsoleShell, type SubNavGroup } from "@/components/app/SideNav";
import { ActivityTab } from "@/components/operator/ActivityTab";
import { BusinessesTab } from "@/components/operator/BusinessesTab";
import { DemosTab } from "@/components/operator/DemosTab";
import { OnboardingQuestionsTab } from "@/components/operator/OnboardingQuestionsTab";
import { OnboardingTab } from "@/components/operator/OnboardingTab";
import { OverviewTab } from "@/components/operator/OverviewTab";
import { PlansTab } from "@/components/operator/PlansTab";
import { PoliciesTab } from "@/components/operator/PoliciesTab";
import { UsersTab } from "@/components/operator/UsersTab";
import { ScrollTabs } from "@/components/ScrollTabs";
import { ApiError, api, type Me } from "@/lib/api";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "businesses", label: "Businesses" },
  { id: "demos", label: "Demos" },
  { id: "onboarding", label: "Onboarding" },
  { id: "questions", label: "Onboarding questions" },
  { id: "users", label: "Users" },
  { id: "plans", label: "Plans" },
  { id: "policies", label: "Policies" },
  { id: "activity", label: "Activity" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const tabsOf = (...ids: Tab[]) => TABS.filter((item) => ids.includes(item.id));
/** The same tabs as the sidebar shows them on a wide screen, in groups. */
const GROUPS: SubNavGroup<Tab>[] = [
  { id: "home", items: tabsOf("overview") },
  { id: "customers", label: "Customers", items: tabsOf("businesses", "users", "demos") },
  { id: "onboarding", label: "Onboarding", items: tabsOf("onboarding", "questions") },
  { id: "platform", label: "Platform", items: tabsOf("plans", "policies", "activity") },
];

/**
 * Operator console for Traiblazer staff (super admins): businesses, users, plans, platform
 * policies and an audit trail. Staff use dedicated accounts that never belong to a business, and
 * the API returns 404 to everyone else. Internal tool, so English only.
 */
export default function OperatorPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied">("loading");
  const [tab, setTab] = useState<Tab>("overview");
  const [business, setBusiness] = useState<string | null>(null);

  // "Back to operator console" from a business's pages reopens that business.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("business");
    if (id) {
      setBusiness(id);
      setTab("businesses");
    }
  }, []);

  useEffect(() => {
    api<Me>("/v1/auth/me")
      .then((data) => {
        setMe(data);
        setState(data.user.platformRole === "super_admin" ? "ready" : "denied");
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else setState("denied");
      });
  }, [router]);

  if (state === "loading") return <p className="muted p-8">Loading…</p>;
  if (state === "denied") {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-12">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <Link href="/dashboard" className="underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <ConsoleShell
      staff
      sub={{
        label: "Operator console",
        title: "Operator console",
        note: me?.user.email,
        groups: GROUPS,
        selected: tab,
        onSelect: setTab,
      }}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8" lang="en">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Operator console</p>
            <h1 className="mt-1 text-2xl font-semibold">{TABS.find((item) => item.id === tab)?.label}</h1>
          </div>
          <span className="badge badge-accent">Staff only</span>
        </header>

        {/* Phone: the tabs in a row. A wide screen has them in the sidebar instead. */}
        <div className="lg:hidden">
          <ScrollTabs selectedKey={tab} label="Operator console">
            {TABS.map(({ id, label }) => (
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
          {tab === "overview" && <OverviewTab />}
          {tab === "businesses" && <BusinessesTab selected={business} onSelect={setBusiness} />}
          {tab === "demos" && <DemosTab />}
          {tab === "onboarding" && <OnboardingTab />}
          {tab === "questions" && <OnboardingQuestionsTab />}
          {tab === "users" && (
            <UsersTab
              onOpenBusiness={(id) => {
                setBusiness(id);
                setTab("businesses");
              }}
            />
          )}
          {tab === "plans" && <PlansTab />}
          {tab === "policies" && <PoliciesTab />}
          {tab === "activity" && <ActivityTab />}
        </section>
      </div>
    </ConsoleShell>
  );
}
