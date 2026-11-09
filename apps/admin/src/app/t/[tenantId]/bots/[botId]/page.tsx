"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppearanceTab } from "@/components/bot/AppearanceTab";
import { ConversationsTab } from "@/components/bot/ConversationsTab";
import { GeneralTab } from "@/components/bot/GeneralTab";
import { KnowledgeTab } from "@/components/bot/KnowledgeTab";
import { ShareTab } from "@/components/bot/ShareTab";
import { WorkflowsTab } from "@/components/bot/WorkflowsTab";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SupportBanner } from "@/components/SupportBanner";
import { ApiError, api, type BotDetail } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Tab = "knowledge" | "workflows" | "general" | "appearance" | "test" | "share" | "conversations";
const TABS: Tab[] = ["knowledge", "workflows", "general", "appearance", "test", "share", "conversations"];

export default function BotPage() {
  const { tenantId, botId } = useParams<{ tenantId: string; botId: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const [detail, setDetail] = useState<BotDetail | null>(null);
  const [tab, setTab] = useState<Tab>("knowledge");
  const [testKey, setTestKey] = useState(0);
  const base = `/v1/tenants/${tenantId}/bots/${botId}`;

  const load = useCallback(async () => {
    try {
      setDetail(await api<BotDetail>(base));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/login");
    }
  }, [base, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!detail) return <p className="muted p-8">{t("common.loading")}</p>;
  const { bot } = detail;
  const key = detail.keys[0]?.publicKey;

  async function setStatus(status: "active" | "paused") {
    await api(base, { method: "PATCH", body: { status } });
    await load();
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:py-10">
      <SupportBanner tenantId={tenantId} />
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/dashboard" className="btn-text -ms-3 text-sm">
            ← {t("bots.back")}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{bot.name}</h1>
          <p className="muted mt-1 text-sm">
            {detail.pack?.name ?? bot.pack} · {t(`bots.status.${bot.status}`)} · {bot.languages.join(", ")}
            {bot.hostedPageEnabled && ` · ${t("bots.webOn")}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LanguageSwitcher />
          {bot.status === "active" ? (
            <button type="button" className="btn btn-ghost" onClick={() => setStatus("paused")}>
              {t("bots.pause")}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => setStatus("active")}>
              {t("bots.activate")}
            </button>
          )}
        </div>
      </header>

      <div role="tablist" className="tabs">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            className="tab"
            onClick={() => {
              setTab(id);
              if (id === "test") setTestKey((k) => k + 1);
            }}
          >
            {t(`bots.tab.${id}`)}
          </button>
        ))}
      </div>

      <section className="card p-5 sm:p-7" role="tabpanel">
        {tab === "knowledge" && <KnowledgeTab base={base} />}
        {tab === "test" && key && (
          <div className="flex flex-col gap-3">
            <p className="muted text-sm">{t("test.hint")}</p>
            <iframe
              key={testKey}
              title={t("bots.tab.test")}
              src={`${detail.chatUrl}/c/${key}?embed=playground`}
              className="h-[620px] w-full rounded-[20px] bg-[var(--surface-2)]"
            />
          </div>
        )}
        {tab === "workflows" && <WorkflowsTab detail={detail} base={base} onChange={load} />}
        {tab === "general" && <GeneralTab detail={detail} base={base} onChange={load} />}
        {tab === "appearance" && (
          <AppearanceTab detail={detail} base={base} tenantId={tenantId} onChange={load} />
        )}
        {tab === "share" && <ShareTab detail={detail} base={base} onChange={load} />}
        {tab === "conversations" && <ConversationsTab base={base} />}
      </section>
    </div>
  );
}
