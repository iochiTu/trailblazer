"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { lastTenant, useMe } from "@/components/app/useMe";
import { useI18n } from "@/lib/i18n";

/** The owner app's start page: the inbox of the business opened last (or the first one). */
export default function InboxStart() {
  const { t } = useI18n();
  const router = useRouter();
  const { me, error } = useMe();

  useEffect(() => {
    if (!me) return;
    if (me.user.platformRole) return router.replace("/operator");
    const remembered = lastTenant();
    const tenant = me.tenants.find((item) => item.id === remembered) ?? me.tenants[0];
    router.replace(tenant ? `/t/${tenant.id}/inbox` : "/dashboard");
  }, [me, router]);

  return (
    <p className={error ? "error p-8" : "muted p-8"}>{error ? t("common.error") : t("common.loading")}</p>
  );
}
