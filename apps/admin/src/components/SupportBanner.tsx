"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Shown on a business's pages only when Traiblazer staff open them through support access
 * (business users never see it). Staff UI, so English only.
 */
export function SupportBanner({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<{ name: string; support: boolean } | null>(null);

  useEffect(() => {
    api<{ tenant: { name: string; support: boolean } }>(`/v1/tenants/${tenantId}`)
      .then((res) => setTenant(res.tenant))
      .catch(() => setTenant(null));
  }, [tenantId]);

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
