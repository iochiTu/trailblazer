"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConsoleShell, type SubNavGroup } from "@/components/app/SideNav";
import { AddonsTab } from "@/components/bot/AddonsTab";
import { AgentTab } from "@/components/bot/AgentTab";
import { AppearanceTab } from "@/components/bot/AppearanceTab";
import { ConversationsTab } from "@/components/bot/ConversationsTab";
import { GeneralTab } from "@/components/bot/GeneralTab";
import { InsightsTab } from "@/components/bot/InsightsTab";
import { KnowledgeTab } from "@/components/bot/KnowledgeTab";
import { PageTab } from "@/components/bot/PageTab";
import { PhoneTab } from "@/components/bot/PhoneTab";
import { RequestsTab } from "@/components/bot/RequestsTab";
import { ShareTab } from "@/components/bot/ShareTab";
import { WorkflowsTab } from "@/components/bot/WorkflowsTab";
import { ScrollTabs } from "@/components/ScrollTabs";
import { SupportBanner } from "@/components/SupportBanner";
import { ApiError, api, type BotDetail } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Tab =
  | "agent"
  | "knowledge"
  | "page"
  | "insights"
  | "workflows"
  | "addons"
  | "general"
  | "appearance"
  | "test"
  | "share"
  | "phone"
  | "requests"
  | "conversations";
const TABS: Tab[] = [
  "agent",
  "knowledge",
  "page",
  "insights",
  "workflows",
  "addons",
  "general",
  "appearance",
  "test",
  "share",
  "phone",
  "requests",
  "conversations",
];
const isTab = (value: string | null): value is Tab => TABS.includes(value as Tab);
/** The same tabs as the sidebar shows them on a wide screen: in groups, by what they are for. */
const GROUPS: { id: "train" | "channels" | "activity" | "settings"; tabs: Tab[] }[] = [
  { id: "train", tabs: ["agent", "knowledge", "workflows", "addons", "test"] },
  { id: "channels", tabs: ["page", "share", "phone"] },
  { id: "activity", tabs: ["requests", "conversations", "insights"] },
  { id: "settings", tabs: ["general", "appearance"] },
];

export default function BotPage() {
  const { tenantId, botId } = useParams<{ tenantId: string; botId: string }>();
  const { t } = useI18n();
  const router = useRouter();
  // Links can open a tab directly, e.g. ?tab=conversations from a notification email.
  const requestedTab = useSearchParams().get("tab");
  const [detail, setDetail] = useState<BotDetail | null>(null);
  const [tab, setTab] = useState<Tab>(isTab(requestedTab) ? requestedTab : "knowledge");
  const [testKey, setTestKey] = useState(0);
  /** Questions the assistant couldn't answer, shown on the Knowledge tab. */
  const [openGaps, setOpenGaps] = useState(0);
  /** Requests waiting for the business, shown on the Requests tab. */
  const [newRequests, setNewRequests] = useState(0);
  /** Conversation to open on the Conversations tab (from a request). */
  const [conversationId, setConversationId] = useState<string | null>(null);
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

  useEffect(() => {
    void api<{ newCount: number }>(`${base}/leads?status=new`)
      .then((d) => setNewRequests(d.newCount))
      .catch(() => {});
    void api<{ openCount: number }>(`${base}/gaps`)
      .then((d) => setOpenGaps(d.openCount))
      .catch(() => {});
  }, [base]);

  if (!detail) return <p className="muted p-8">{t("common.loading")}</p>;
  const { bot } = detail;
  const key = detail.keys[0]?.publicKey;

  async function setStatus(status: "active" | "paused") {
    await api(base, { method: "PATCH", body: { status } });
    await load();
  }

  function selectTab(id: Tab) {
    setTab(id);
    if (id === "test") setTestKey((k) => k + 1);
  }

  const badges: Partial<Record<Tab, number>> = { knowledge: openGaps, requests: newRequests };
  const groups: SubNavGroup<Tab>[] = GROUPS.map((group) => ({
    id: group.id,
    label: t(`bots.group.${group.id}`),
    items: group.tabs.map((id) => ({ id, label: t(`bots.tab.${id}`), badge: badges[id] })),
  }));

  return (
    <ConsoleShell
      tenantId={tenantId}
      active="bots"
      sub={{
        label: bot.name,
        title: bot.name,
        note: `${detail.pack?.name ?? bot.pack} · ${t(`bots.status.${bot.status}`)}`,
        back: { href: "/dashboard", label: t("bots.back") },
        groups,
        selected: tab,
        onSelect: selectTab,
      }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 lg:py-8">
        <SupportBanner tenantId={tenantId} />
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/dashboard" className="btn-text -ms-3 text-sm lg:hidden">
              ← {t("bots.back")}
            </Link>
            <h1 className="mt-1 text-2xl font-semibold">{bot.name}</h1>
            <p className="muted mt-1 text-sm">
              {detail.pack?.name ?? bot.pack} · {t(`bots.status.${bot.status}`)} · {bot.languages.join(", ")}
              {bot.hostedPageEnabled && ` · ${t("bots.webOn")}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
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

        {/* Phone: the tabs in a row. A wide screen has them in the sidebar instead. */}
        <div className="lg:hidden">
          <ScrollTabs selectedKey={tab} label={bot.name}>
            {TABS.map((id) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={tab === id}
                className="tab"
                onClick={() => selectTab(id)}
              >
                {t(`bots.tab.${id}`)}
                {id === "knowledge" && openGaps > 0 && (
                  <span className="badge badge-accent ms-2">{openGaps}</span>
                )}
                {id === "requests" && newRequests > 0 && (
                  <span className="badge badge-accent ms-2">{newRequests}</span>
                )}
              </button>
            ))}
          </ScrollTabs>
        </div>

        <section className="card flex flex-col gap-5 p-5 sm:p-7" role="tabpanel">
          <h2 className="hidden text-lg font-semibold lg:block">{t(`bots.tab.${tab}`)}</h2>
          {tab === "knowledge" && (
            <KnowledgeTab detail={detail} base={base} onChange={load} onGapCount={setOpenGaps} />
          )}
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
          {tab === "agent" && <AgentTab base={base} onChange={load} />}
          {tab === "page" && <PageTab detail={detail} base={base} onChange={load} />}
          {tab === "insights" && <InsightsTab base={base} onOpenKnowledge={() => setTab("knowledge")} />}
          {tab === "workflows" && <WorkflowsTab detail={detail} base={base} onChange={load} />}
          {tab === "addons" && <AddonsTab base={base} />}
          {tab === "general" && <GeneralTab detail={detail} base={base} onChange={load} />}
          {tab === "appearance" && (
            <AppearanceTab detail={detail} base={base} tenantId={tenantId} onChange={load} />
          )}
          {tab === "share" && <ShareTab detail={detail} base={base} onChange={load} />}
          {tab === "phone" && <PhoneTab base={base} />}
          {tab === "requests" && (
            <RequestsTab
              detail={detail}
              base={base}
              onChange={load}
              onCount={setNewRequests}
              onOpenConversation={(id) => {
                setConversationId(id);
                setTab("conversations");
              }}
            />
          )}
          {tab === "conversations" && <ConversationsTab base={base} openId={conversationId} />}
        </section>
      </div>
    </ConsoleShell>
  );
}
