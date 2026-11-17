"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { forgetPushDevice } from "@/lib/push";
import { lastTenant, rememberTenant, useMe } from "./useMe";

/** The first level of the menu: the places a business owner goes. */
export type Section = "bots" | "inbox" | "contacts" | "usage" | "billing" | "alerts" | "agency";

export interface SubNavItem<T extends string = string> {
  id: T;
  label: string;
  /** A count shown beside the label when above zero (e.g. new requests). */
  badge?: number;
}

export interface SubNavGroup<T extends string = string> {
  id: string;
  /** The group's heading; a group without one is always open. */
  label?: string;
  items: SubNavItem<T>[];
}

/**
 * The second level of the menu. While a page has one, it replaces the first level (the way a
 * settings menu takes over the sidebar): a link back, what is open, then its tabs in groups.
 */
export interface SubNav<T extends string = string> {
  /** Names the tabs for screen readers. */
  label: string;
  title: string;
  note?: string;
  back?: { href: string; label: string };
  groups: SubNavGroup<T>[];
  selected: T;
  onSelect: (id: T) => void;
}

interface NavProps<T extends string> {
  /** The business the links point at; without one, the business opened last. */
  tenantId?: string | null;
  active?: Section;
  sub?: SubNav<T>;
  /** Called instead of leaving the page when another business is picked. */
  onTenantChange?: (id: string) => void;
  /** The operator console: staff only, English only, no business menu. */
  staff?: boolean;
}

const ICONS: Record<Section, ReactNode> = {
  bots: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 3v4M9 12h.01M15 12h.01M9.5 16h5" />
    </>
  ),
  inbox: <path d="M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2-8Z" />,
  contacts: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 19.5a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.3" />
    </>
  ),
  usage: <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />,
  billing: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  alerts: <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9ZM10 19a2 2 0 0 0 4 0" />,
  agency: (
    <>
      <path d="M3 21h18M5 21V7l7-4 7 4v14" />
      <path d="M9 21v-5h6v5M9 10h.01M15 10h.01M12 10h.01" />
    </>
  ),
};

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/**
 * The console's frame: a dark sidebar down the side of a wide screen, with the page beside it. On
 * a phone the sidebar is a drawer behind a menu button in a slim top bar.
 */
export function ConsoleShell<T extends string = string>({
  children,
  ...nav
}: NavProps<T> & { children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="console">
      <div className="console-topbar">
        <button
          type="button"
          className="console-menu"
          aria-label={nav.staff ? "Menu" : t("nav.menu")}
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Icon size={22}>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </Icon>
        </button>
        <BrandMark size={28} />
        <span className="truncate font-semibold">{nav.staff ? "Operator console" : t("app.name")}</span>
      </div>
      <SideNav {...nav} open={open} onClose={() => setOpen(false)} />
      <div className="console-main">{children}</div>
    </div>
  );
}

/** The sidebar itself. Always shown on a wide screen; below that only while `open`. */
export function SideNav<T extends string = string>({
  tenantId,
  active,
  sub,
  onTenantChange,
  staff,
  open = false,
  onClose,
}: NavProps<T> & { open?: boolean; onClose?: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const { me } = useMe();
  /** Groups the user folded away (the group holding the selected tab always stays open). */
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (event: globalThis.KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const tenants = me?.tenants ?? [];
  // The business opened last is read only once the account has loaded (never while rendering on
  // the server).
  const remembered = me ? lastTenant() : null;
  const current =
    tenantId ?? (tenants.some((item) => item.id === remembered) ? remembered : (tenants[0]?.id ?? null));
  const currentTenant = tenants.find((item) => item.id === current);
  const role = currentTenant?.role;
  // An agency's client sees the agency's name and logo in place of ours (docs/AGENCY.md §5).
  const brand = !staff && currentTenant?.agency ? currentTenant.agency : null;
  const ownTenants = tenants.filter((item) => item.via !== "agency");
  const agencyTenants = tenants.filter((item) => item.via === "agency");

  const links: { id: Section; href: string; label: string }[] = [
    { id: "bots", href: "/dashboard", label: t("nav.bots") },
    { id: "inbox", href: current ? `/t/${current}/inbox` : "/inbox", label: t("nav.inbox") },
    ...(current
      ? [
          { id: "contacts" as const, href: `/t/${current}/contacts`, label: t("nav.contacts") },
          { id: "usage" as const, href: `/t/${current}/usage`, label: t("nav.usage") },
        ]
      : []),
    ...(current && (role === "owner" || role === "admin")
      ? [{ id: "billing" as const, href: `/t/${current}/billing`, label: t("nav.billing") }]
      : []),
    {
      id: "alerts",
      href: current ? `/settings/notifications?t=${current}` : "/settings/notifications",
      label: t("nav.alerts"),
    },
    ...((me?.agencies.length ?? 0) > 0
      ? [{ id: "agency" as const, href: "/agency", label: t("nav.agency") }]
      : []),
  ];

  function switchTenant(id: string) {
    rememberTenant(id);
    onClose?.();
    if (onTenantChange) onTenantChange(id);
    else if (active === "alerts") router.push(`/settings/notifications?t=${id}`);
    else if (active && active !== "bots") router.push(`/t/${id}/${active}`);
    else router.push("/dashboard");
  }

  async function signOut() {
    // The server forgets this device's push registration with the session.
    forgetPushDevice();
    await api("/v1/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  /** Up, Down, Home and End move between the tabs and select (WAI-ARIA tabs, vertical). */
  function onTabKeys(event: KeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    const at = tabs.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowDown"
            ? (at + 1) % tabs.length
            : event.key === "ArrowUp"
              ? (at - 1 + tabs.length) % tabs.length
              : -1;
    if (next < 0) return;
    event.preventDefault();
    tabs[next]!.focus();
    tabs[next]!.click();
  }

  const menuLabel = staff ? "Menu" : t("nav.menu");
  const closeLabel = staff ? "Close menu" : t("nav.closeMenu");

  return (
    <>
      {open && (
        <button
          type="button"
          className="sidenav-scrim"
          aria-label={closeLabel}
          tabIndex={-1}
          onClick={onClose}
        />
      )}
      <aside className="sidenav" data-open={open} aria-label={menuLabel} lang={staff ? "en" : undefined}>
        <div className="sidenav-brand">
          <Link href={staff ? "/operator" : "/dashboard"} className="flex min-w-0 items-center gap-2.5">
            {brand?.logoUrl ? (
              // biome-ignore lint/performance/noImgElement: the agency's logo is on its own site
              <img
                src={brand.logoUrl}
                alt=""
                width={30}
                height={30}
                className="h-[30px] w-[30px] rounded-md object-contain"
              />
            ) : (
              !brand && <BrandMark size={30} />
            )}
            <span className="truncate text-base font-semibold text-white">
              {brand ? brand.name : t("app.name")}
            </span>
          </Link>
          {staff && <span className="badge badge-accent">Staff only</span>}
          <button type="button" className="sidenav-close" aria-label={closeLabel} onClick={onClose}>
            <Icon>
              <path d="M6 6l12 12M18 6 6 18" />
            </Icon>
          </button>
        </div>

        {!staff && tenants.length > 1 && (
          <div className="px-3 pb-3">
            <select
              className="input text-sm font-medium"
              value={current ?? ""}
              onChange={(event) => switchTenant(event.target.value)}
              aria-label={t("tenants.title")}
            >
              {ownTenants.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
              {agencyTenants.length > 0 && (
                <optgroup label={t("agency.clientsGroup")}>
                  {agencyTenants.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        )}
        {!staff && tenants.length === 1 && <p className="sidenav-business truncate">{tenants[0]!.name}</p>}

        <div className="sidenav-scroll">
          {sub ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys for the tabs inside
            <div className="flex flex-col gap-1" onKeyDown={onTabKeys}>
              {sub.back && (
                <Link href={sub.back.href} className="sidenav-item sidenav-back">
                  <Icon size={18}>
                    <path d="m15 18-6-6 6-6" className="origin-center rtl:rotate-180" />
                  </Icon>
                  {sub.back.label}
                </Link>
              )}
              <div className="px-3 pt-2 pb-3">
                <p className="truncate text-[0.9375rem] font-semibold text-white">{sub.title}</p>
                {sub.note && <p className="sidenav-note">{sub.note}</p>}
              </div>
              {sub.groups.map((group) => {
                const holdsSelected = group.items.some((item) => item.id === sub.selected);
                const shown = !group.label || holdsSelected || !folded.has(group.id);
                const waiting = group.items.reduce((sum, item) => sum + (item.badge ?? 0), 0);
                return (
                  <div key={group.id} className="flex flex-col gap-0.5">
                    {group.label && (
                      <button
                        type="button"
                        className="sidenav-heading"
                        aria-expanded={shown}
                        onClick={() =>
                          setFolded((was) => {
                            const next = new Set(was);
                            if (shown) next.add(group.id);
                            else next.delete(group.id);
                            return next;
                          })
                        }
                      >
                        <span className="min-w-0 flex-1 truncate">{group.label}</span>
                        {!shown && waiting > 0 && <span className="badge badge-accent">{waiting}</span>}
                        <Icon size={14}>
                          <path d={shown ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6"} />
                        </Icon>
                      </button>
                    )}
                    {shown && (
                      <div
                        role="tablist"
                        aria-orientation="vertical"
                        aria-label={group.label ?? sub.label}
                        className={group.label ? "sidenav-tree" : "flex flex-col gap-0.5"}
                      >
                        {group.items.map((item) => (
                          <button
                            key={item.id}
                            role="tab"
                            type="button"
                            aria-selected={sub.selected === item.id}
                            className="sidenav-item"
                            onClick={() => {
                              sub.onSelect(item.id);
                              onClose?.();
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {!!item.badge && <span className="badge badge-accent">{item.badge}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <nav aria-label={menuLabel}>
              <ul className="flex flex-col gap-0.5">
                {links.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={active === item.id ? "page" : undefined}
                      className="sidenav-item"
                      onClick={onClose}
                    >
                      <Icon>{ICONS[item.id]}</Icon>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>

        <div className="sidenav-foot">
          {me && <p className="sidenav-note truncate px-3">{staff ? me.user.email : me.user.name}</p>}
          {!staff && (
            <div className="px-3">
              <LanguageSwitcher />
            </div>
          )}
          <button type="button" className="sidenav-item" onClick={signOut}>
            <Icon>
              <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />
            </Icon>
            {staff ? "Sign out" : t("nav.signOut")}
          </button>
        </div>
      </aside>
    </>
  );
}
