"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { ActivityTab } from "@/components/operator/ActivityTab";
import { BusinessesTab } from "@/components/operator/BusinessesTab";
import { DemosTab } from "@/components/operator/DemosTab";
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
  { id: "users", label: "Users" },
  { id: "plans", label: "Plans" },
  { id: "policies", label: "Policies" },
  { id: "activity", label: "Activity" },
] as const;
type Tab = (typeof TABS)[number]["id"];

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

  async function signOut() {
    await api("/v1/auth/logout", { method: "POST" });
    router.replace("/login");
  }

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
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:py-10" lang="en">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-3 text-xl font-semibold">
            <BrandMark />
            Operator console
            <span className="badge badge-accent">Staff only</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="muted text-sm">Signed in as {me?.user.email}</span>
          <button className="btn btn-ghost" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

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

      <section role="tabpanel">
        {tab === "overview" && <OverviewTab />}
        {tab === "businesses" && <BusinessesTab selected={business} onSelect={setBusiness} />}
        {tab === "demos" && <DemosTab />}
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
  );
}
