"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import { useI18n } from "@/lib/i18n";
import { SideNav } from "./SideNav";
import { SwitchBar } from "./SwitchBar";

type Tab = "inbox" | "contacts" | "bots" | "alerts";

/**
 * The owner app's frame (PLAN §20.3), phone first: a top bar (title, back link, an action) and a
 * bottom tab bar within thumb reach, clear of the iPhone's notch and home indicator. On a wide
 * screen the console's sidebar replaces the tab bar and the page stays a centered column.
 */
export function AppShell({
  title,
  tab,
  tenantId,
  back,
  action,
  children,
}: {
  title: string;
  tab?: Tab;
  /** The business the tabs point at (the inbox is per business). */
  tenantId?: string | null;
  back?: { href: string; label: string };
  action?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const tabs: { id: Tab; href: string; label: string; icon: ReactNode }[] = [
    {
      id: "inbox",
      href: tenantId ? `/t/${tenantId}/inbox` : "/inbox",
      label: t("nav.inbox"),
      icon: <path d="M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2-8Z" />,
    },
    // Contacts belong to one business: without one, the inbox picks it first.
    ...(tenantId
      ? [
          {
            id: "contacts" as const,
            href: `/t/${tenantId}/contacts`,
            label: t("nav.contacts"),
            icon: (
              <>
                <circle cx="9" cy="8" r="3.5" />
                <path d="M2.5 19.5a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.3" />
              </>
            ),
          },
        ]
      : []),
    {
      id: "bots",
      href: "/dashboard",
      label: t("nav.bots"),
      icon: (
        <>
          <rect x="4" y="7" width="16" height="12" rx="3" />
          <path d="M12 3v4M9 12h.01M15 12h.01M9.5 16h5" />
        </>
      ),
    },
    {
      id: "alerts",
      href: tenantId ? `/settings/notifications?t=${tenantId}` : "/settings/notifications",
      label: t("nav.alerts"),
      icon: <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9ZM10 19a2 2 0 0 0 4 0" />,
    },
  ];

  return (
    <div className="console console-main flex min-h-dvh flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
      <SideNav tenantId={tenantId} active={tab} />
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex min-h-14 max-w-2xl items-center gap-2 px-4">
          {back ? (
            <Link
              href={back.href}
              className="-ms-2 flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-medium text-[var(--accent)]"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="rtl:rotate-180"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              {back.label}
            </Link>
          ) : (
            <BrandMark size={28} />
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
          {action}
        </div>
        {/* Always in view: whether notifications reach me and whether the assistant is answering. */}
        <SwitchBar tenantId={tenantId} />
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-4">{children}</main>

      <nav
        aria-label={t("app.name")}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="mx-auto grid max-w-2xl auto-cols-fr grid-flow-col">
          {tabs.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={tab === item.id ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${
                  tab === item.id ? "text-[var(--accent)]" : "muted"
                }`}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {item.icon}
                </svg>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
