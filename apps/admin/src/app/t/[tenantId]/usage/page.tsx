"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SupportBanner } from "@/components/SupportBanner";
import { DailyChart, type DailyPoint } from "@/components/usage/DailyChart";
import { ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface UsageReport {
  plan: {
    id: string;
    name: Record<"en" | "fr", string>;
    monthlyQuestions: number;
    concurrent: number;
    perMinute: number;
  };
  limits: {
    monthlyQuestionLimit: number | null;
    effectiveMonthlyLimit: number;
    visitorDailyLimit: number | null;
    defaultVisitorDailyLimit: number;
    maxConversationQuestions: number;
  };
  month: {
    period: string;
    resetsAt: string;
    questions: number;
    remaining: number;
    blockedQuota: number;
    blockedBusy: number;
    blockedVisitor: number;
    costMicros: number | null;
  };
  daily: DailyPoint[];
  byAssistant: { botId: string; name: string; questions: number }[];
  byChannel: { channel: string; questions: number }[];
}

type Role = "owner" | "admin" | "editor" | "viewer";

function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="muted text-sm">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {note && <span className="muted text-xs">{note}</span>}
    </div>
  );
}

/** Monthly quota meter: thin rounded bar; status color only with an icon and a text label. */
function QuotaMeter({ report }: { report: UsageReport }) {
  const { t, language } = useI18n();
  const { questions } = report.month;
  const limit = report.limits.effectiveMonthlyLimit;
  const share = limit ? Math.min(1, questions / limit) : 0;
  const status = share >= 1 ? "full" : share >= 0.8 ? "warning" : "ok";
  const color =
    status === "full"
      ? "var(--status-critical)"
      : status === "warning"
        ? "var(--status-warning)"
        : "var(--chart)";
  const icon = status === "full" ? "⛔" : status === "warning" ? "⚠️" : "✓";
  const fmt = new Intl.NumberFormat(language);

  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{t("usage.thisMonth")}</h2>
        <span className="muted text-sm">{t("usage.resets", { date: new Date(report.month.resetsAt) })}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums">{fmt.format(questions)}</span>
        <span className="muted tabular-nums">/ {fmt.format(limit)}</span>
      </div>
      {/* Native meter for assistive tech; the styled bar below is its visual twin. */}
      <meter
        className="sr-only"
        min={0}
        max={limit}
        value={questions}
        aria-label={t("usage.ofLimit", { used: questions, limit })}
      />
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--grid)]" aria-hidden="true">
        {share > 0 && (
          <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: color }} />
        )}
      </div>
      <p className="flex items-center gap-2 text-sm" role="status">
        <span aria-hidden="true">{icon}</span>
        {t(`usage.status.${status}`)}
      </p>
    </section>
  );
}

function LimitsForm({
  report,
  base,
  onSaved,
}: {
  report: UsageReport;
  base: string;
  onSaved: () => Promise<void>;
}) {
  const { t, language } = useI18n();
  const lang2 = language === "fr" ? "fr" : "en";
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const num = (name: string) => {
      const raw = String(data.get(name) ?? "").trim();
      return raw ? Number(raw) : null;
    };
    setError(null);
    setSaved(false);
    try {
      await api(`${base}/limits`, {
        method: "PATCH",
        body: { monthlyQuestionLimit: num("monthly"), visitorDailyLimit: num("visitor") },
      });
      await onSaved();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("usage.monthlyLimit")}</span>
        <input
          className="input"
          style={{ width: "10rem" }}
          name="monthly"
          type="number"
          min={1}
          max={report.plan.monthlyQuestions}
          defaultValue={report.limits.monthlyQuestionLimit ?? ""}
          placeholder={String(report.plan.monthlyQuestions)}
        />
        <span className="muted text-xs">
          {t("usage.monthlyLimitHint", { plan: report.plan.name[lang2], max: report.plan.monthlyQuestions })}
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("usage.visitorLimit")}</span>
        <input
          className="input"
          style={{ width: "10rem" }}
          name="visitor"
          type="number"
          min={1}
          max={500}
          defaultValue={report.limits.visitorDailyLimit ?? ""}
          placeholder={String(report.limits.defaultVisitorDailyLimit)}
        />
        <span className="muted text-xs">
          {t("usage.visitorLimitHint", { default: report.limits.defaultVisitorDailyLimit })}{" "}
          {t("usage.conversationLimitNote", { max: report.limits.maxConversationQuestions })}
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button className="btn" type="submit">
          {t("common.save")}
        </button>
        {saved && (
          <span className="text-sm" role="status">
            {t("common.saved")}
          </span>
        )}
      </div>
      {error && (
        <p className="error text-sm" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export default function UsagePage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { t, language } = useI18n();
  const router = useRouter();
  const [report, setReport] = useState<UsageReport | null>(null);
  const [tenant, setTenant] = useState<{ name: string; role: Role } | null>(null);
  const base = `/v1/tenants/${tenantId}`;
  const fmt = new Intl.NumberFormat(language);

  const load = useCallback(async () => {
    try {
      const [usage, detail] = await Promise.all([
        api<UsageReport>(`${base}/usage?days=30`),
        api<{ tenant: { name: string; role: Role } }>(base),
      ]);
      setReport(usage);
      setTenant(detail.tenant);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/login");
    }
  }, [base, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!report || !tenant) return <p className="muted p-8">{t("common.loading")}</p>;

  const refused = report.month.blockedQuota + report.month.blockedBusy + report.month.blockedVisitor;
  const canManage = tenant.role === "owner" || tenant.role === "admin";
  const channelName = (c: string) =>
    ["hosted", "inline", "widget", "playground"].includes(c) ? t(`usage.channel.${c as "hosted"}`) : c;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      <SupportBanner tenantId={tenantId} />
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/dashboard" className="muted text-sm underline-offset-4 hover:underline">
            ← {t("tenants.title")}
          </Link>
          <h1 className="text-xl font-semibold">
            {t("usage.title")} · {tenant.name}
          </h1>
        </div>
        <LanguageSwitcher />
      </header>

      <QuotaMeter report={report} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("usage.remaining")} value={fmt.format(report.month.remaining)} />
        <StatTile
          label={t("usage.refused")}
          value={fmt.format(refused)}
          note={t("usage.refusedBreakdown", {
            quota: report.month.blockedQuota,
            busy: report.month.blockedBusy,
            abuse: report.month.blockedVisitor,
          })}
        />
        <StatTile
          label={t("usage.conversations30")}
          value={fmt.format(report.daily.reduce((sum, d) => sum + d.conversations, 0))}
        />
        {report.month.costMicros !== null && (
          <StatTile
            label={t("usage.cost")}
            value={new Intl.NumberFormat(language, { style: "currency", currency: "USD" }).format(
              report.month.costMicros / 1_000_000,
            )}
            note={t("usage.costNote")}
          />
        )}
      </div>

      <section className="card p-5">
        <DailyChart data={report.daily} />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card flex flex-col gap-2 p-5">
          <h3 className="font-medium">{t("usage.byAssistant")}</h3>
          <table className="w-full text-sm">
            <tbody className="tabular-nums">
              {report.byAssistant.map((row) => (
                <tr key={row.botId} className="border-t border-[var(--border)] first:border-0">
                  <td className="py-1.5">{row.name}</td>
                  <td className="py-1.5 text-end">{fmt.format(row.questions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card flex flex-col gap-2 p-5">
          <h3 className="font-medium">{t("usage.byChannel")}</h3>
          {report.byChannel.length === 0 ? (
            <p className="muted text-sm">{t("usage.noData")}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="tabular-nums">
                {report.byChannel.map((row) => (
                  <tr key={row.channel} className="border-t border-[var(--border)] first:border-0">
                    <td className="py-1.5">{channelName(row.channel)}</td>
                    <td className="py-1.5 text-end">{fmt.format(row.questions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card flex flex-col gap-4 p-5">
        <h2 className="font-medium">{t("usage.limits")}</h2>
        {canManage ? (
          <LimitsForm report={report} base={base} onSaved={load} />
        ) : (
          <p className="muted text-sm">
            {t("usage.limitsReadOnly", { limit: report.limits.effectiveMonthlyLimit })}
          </p>
        )}
        <div className="panel p-4 text-sm">
          <p className="font-medium">{t("usage.protection")}</p>
          <p className="muted">
            {t("usage.protectionHint", {
              concurrent: report.plan.concurrent,
              perMinute: report.plan.perMinute,
            })}
          </p>
        </div>
      </section>
    </div>
  );
}
