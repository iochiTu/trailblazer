"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/app/SideNav";
import { SupportBanner } from "@/components/SupportBanner";
import { ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface BillingPlan {
  id: string;
  nameEn: string;
  nameFr: string;
  priceMonthlyCents: number;
  setupFeeCents: number | null;
  monthlyQuestions: number;
  knowledgeImages: number;
  insights: boolean;
}

interface BillingReport {
  enabled: boolean;
  /** The agency that pays for this business's plan (docs/AGENCY.md §3.5), if any. */
  managedBy: string | null;
  plan: string;
  planName: Record<"en" | "fr", string>;
  demo: boolean;
  canManage: boolean;
  setupFeePaid: boolean;
  hasCustomer: boolean;
  subscription: {
    status: string;
    plan: string | null;
    priceMonthlyCents: number | null;
    currentPeriodEnd: string | null;
    cancelAt: string | null;
  } | null;
  plans: BillingPlan[];
}

const PAYING = ["active", "trialing", "past_due"];

export default function BillingPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense>
      <Billing />
    </Suspense>
  );
}

function Billing() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const search = useSearchParams();
  const { t, language } = useI18n();
  const router = useRouter();
  const [report, setReport] = useState<BillingReport | null>(null);
  const [tenant, setTenant] = useState<{ name: string; support: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const base = `/v1/tenants/${tenantId}`;
  const checkout = search.get("checkout");

  const money = (cents: number) =>
    new Intl.NumberFormat(`${language}-CA`, {
      style: "currency",
      currency: "CAD",
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  const planName = (p: { nameEn: string; nameFr: string }) => (language === "fr" ? p.nameFr : p.nameEn);

  const load = useCallback(async () => {
    try {
      const [billing, detail] = await Promise.all([
        api<BillingReport>(`${base}/billing`),
        api<{ tenant: { name: string; support: boolean } }>(base),
      ]);
      setReport(billing);
      setTenant(detail.tenant);
      return billing;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/login");
      else if (err instanceof ApiError && err.status === 403)
        setMessage({ kind: "error", text: t("billing.ownerOnly") });
      else setMessage({ kind: "error", text: t("common.error") });
      return null;
    }
  }, [base, router, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back from the checkout page: the webhook puts the business on its plan a few seconds later.
  useEffect(() => {
    if (checkout !== "done") return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const latest = await load();
      if (tries >= 10 || PAYING.includes(latest?.subscription?.status ?? "")) clearInterval(timer);
    }, 2000);
    return () => clearInterval(timer);
  }, [checkout, load]);

  async function go(path: string, body?: object) {
    setBusy(path);
    setMessage(null);
    try {
      const { url } = await api<{ url: string }>(`${base}/billing/${path}`, {
        method: "POST",
        body: body ?? {},
      });
      window.location.assign(url);
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : t("common.error") });
      setBusy(null);
    }
  }

  async function switchTo(plan: BillingPlan) {
    if (
      !window.confirm(
        t("billing.switchConfirm", { plan: planName(plan), price: money(plan.priceMonthlyCents) }),
      )
    )
      return;
    setBusy(plan.id);
    setMessage(null);
    try {
      await api(`${base}/billing/plan`, { method: "POST", body: { plan: plan.id } });
      await load();
      setMessage({ kind: "ok", text: t("billing.switched", { plan: planName(plan) }) });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : t("common.error") });
    } finally {
      setBusy(null);
    }
  }

  if (!report || !tenant)
    return message ? (
      <p className="error p-8" role="alert">
        {message.text}
      </p>
    ) : (
      <p className="muted p-8">{t("common.loading")}</p>
    );

  const sub = report.subscription;
  const paying = PAYING.includes(sub?.status ?? "");
  const canBuy = report.enabled && report.canManage && !report.demo && !report.managedBy;
  const statusLabel = (s: string) =>
    s === "active" || s === "trialing" || s === "past_due"
      ? t(`billing.status.${s}`)
      : t("billing.status.other");

  return (
    <ConsoleShell tenantId={tenantId} active="billing">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
        <SupportBanner tenantId={tenantId} />
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/dashboard" className="muted text-sm underline-offset-4 hover:underline lg:hidden">
              ← {t("tenants.title")}
            </Link>
            <h1 className="text-xl font-semibold">
              {t("billing.title")} · {tenant.name}
            </h1>
          </div>
        </header>

        {checkout === "done" && (
          <p className="panel px-4 py-3 text-sm" role="status">
            {t("billing.checkoutDone")}
          </p>
        )}
        {checkout === "cancelled" && (
          <p className="panel px-4 py-3 text-sm" role="status">
            {t("billing.checkoutCancelled")}
          </p>
        )}
        {message && (
          <p
            className={message.kind === "error" ? "error text-sm" : "text-sm"}
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        )}

        <section className="card flex flex-col gap-3 p-5" aria-labelledby="billing-current">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="billing-current" className="font-medium">
              {t("billing.current", { plan: language === "fr" ? report.planName.fr : report.planName.en })}
            </h2>
            {sub && <span className="badge">{statusLabel(sub.status)}</span>}
          </div>
          {sub && paying && sub.priceMonthlyCents != null && (
            <p className="text-sm">{t("billing.price", { price: money(sub.priceMonthlyCents) })}</p>
          )}
          {sub?.status === "past_due" && (
            <p className="text-sm" role="alert">
              ⚠️ {t("billing.pastDue")}
            </p>
          )}
          {paying && sub?.cancelAt && (
            <p className="text-sm">{t("billing.ends", { date: new Date(sub.cancelAt) })}</p>
          )}
          {paying && !sub?.cancelAt && sub?.currentPeriodEnd && (
            <p className="muted text-sm">{t("billing.renews", { date: new Date(sub.currentPeriodEnd) })}</p>
          )}
          {sub && !paying && sub.status !== "incomplete" && <p className="text-sm">{t("billing.ended")}</p>}
          {canBuy && report.hasCustomer && (
            <div>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy !== null}
                onClick={() => go("portal")}
              >
                {t("billing.manage")}
              </button>
            </div>
          )}
          {report.demo && <p className="muted text-sm">{t("billing.demo")}</p>}
          {report.managedBy && (
            <p className="text-sm">{t("billing.managedByAgency", { agency: report.managedBy })}</p>
          )}
          {!report.demo && !report.managedBy && !report.canManage && (
            <p className="muted text-sm">
              {tenant.support ? t("billing.supportOnly") : t("billing.ownerOnly")}
            </p>
          )}
          {!report.enabled && !report.demo && !report.managedBy && (
            <p className="muted text-sm">{t("billing.unavailable")}</p>
          )}
        </section>

        {!report.managedBy && (
          <section className="flex flex-col gap-3" aria-labelledby="billing-plans">
            <h2 id="billing-plans" className="font-medium">
              {t("billing.plans")}
            </h2>
            {report.plans.length === 0 ? (
              <p className="muted text-sm">{t("billing.noPlans")}</p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {report.plans.map((plan) => {
                  const isCurrent = paying && sub?.plan === plan.id;
                  const fee = !report.setupFeePaid && !paying && plan.setupFeeCents ? plan.setupFeeCents : 0;
                  return (
                    <li key={plan.id} className="card flex flex-col gap-2 p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-medium">{planName(plan)}</h3>
                        {isCurrent && <span className="badge badge-accent">{t("billing.currentBadge")}</span>}
                      </div>
                      <p className="text-2xl font-semibold tabular-nums">
                        {t("billing.price", { price: money(plan.priceMonthlyCents) })}
                      </p>
                      {fee > 0 && (
                        <p className="muted text-sm">{t("billing.setupFee", { price: money(fee) })}</p>
                      )}
                      <ul className="muted flex flex-col gap-1 text-sm">
                        <li>{t("billing.questions", { count: plan.monthlyQuestions })}</li>
                        <li>{t("billing.photos", { count: plan.knowledgeImages })}</li>
                        {plan.insights && <li>{t("billing.insights")}</li>}
                      </ul>
                      {canBuy && !isCurrent && (
                        <button
                          type="button"
                          className="btn mt-auto"
                          disabled={busy !== null}
                          aria-busy={busy === plan.id || busy === "checkout"}
                          onClick={() => (paying ? switchTo(plan) : go("checkout", { plan: plan.id }))}
                        >
                          {paying
                            ? t("billing.switch", { plan: planName(plan) })
                            : t("billing.choose", { plan: planName(plan) })}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="muted text-xs">{t("billing.taxes")}</p>
          </section>
        )}
      </div>
    </ConsoleShell>
  );
}
