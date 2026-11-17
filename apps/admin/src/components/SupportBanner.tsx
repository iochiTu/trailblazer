"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface TenantAccess {
  name: string;
  support: boolean;
  via?: "member" | "support" | "agency";
  agency?: { id: string; name: string } | null;
}

/**
 * Shown on a business's pages only to people who don't belong to it: Traiblazer staff helping
 * through support access (staff UI, English only), or the users of the agency that manages it
 * (docs/AGENCY.md §4). The business's own team never sees it.
 */
export function SupportBanner({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const [tenant, setTenant] = useState<TenantAccess | null>(null);

  useEffect(() => {
    api<{ tenant: TenantAccess }>(`/v1/tenants/${tenantId}`)
      .then((res) => setTenant(res.tenant))
      .catch(() => setTenant(null));
  }, [tenantId]);

  if (tenant?.via === "agency" && tenant.agency) {
    return (
      <div
        role="note"
        className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--surface-2)] px-5 py-3 text-sm"
      >
        <span>
          <strong>{t("agency.banner.title", { business: tenant.name })}</strong>{" "}
          {t("agency.banner.body", { agency: tenant.agency.name })}
        </span>
        <Link href="/agency" className="underline">
          {t("agency.banner.back")}
        </Link>
      </div>
    );
  }
  if (!tenant?.support) return null;
  return (
    <div
      role="note"
      lang="en"
      className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[color-mix(in_srgb,var(--status-warning)_55%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_12%,var(--surface))] px-5 py-3 text-sm"
    >
      <span>
        <span aria-hidden="true">🛟 </span>
        <strong>Support mode · {tenant.name}.</strong> You're helping this business as Traiblazer staff.
        Changes you save are recorded in its activity log.
      </span>
      <Link href={`/operator?business=${tenantId}`} className="underline">
        Back to operator console
      </Link>
    </div>
  );
}
