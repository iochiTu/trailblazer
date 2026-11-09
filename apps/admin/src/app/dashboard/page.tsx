"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ApiError, api, type Bot, type Language, type Me, type Pack } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function DashboardPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const data = await api<Me>("/v1/auth/me");
      // Staff accounts don't own businesses; their home is the operator console.
      if (data.user.platformRole) {
        router.replace("/operator");
        return;
      }
      setMe(data);
      setTenantId((current) => current ?? data.tenants[0]?.id ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/login");
      else setError(t("common.error"));
    }
  }, [router, t]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  async function signOut() {
    await api("/v1/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  if (error) return <p className="error p-8">{error}</p>;
  if (!me) return <p className="muted p-8">{t("common.loading")}</p>;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{t("app.name")}</h1>
        <div className="flex items-center gap-4">
          <span className="muted text-sm">{me.user.name}</span>
          <LanguageSwitcher />
          <button className="btn btn-ghost" type="button" onClick={signOut}>
            {t("nav.signOut")}
          </button>
        </div>
      </header>

      <section className="card flex flex-col gap-4 p-5">
        <h2 className="text-lg font-medium">{t("tenants.title")}</h2>
        {me.tenants.length === 0 ? (
          <p className="muted text-sm">{t("tenants.empty")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input max-w-sm"
              value={tenantId ?? ""}
              onChange={(e) => setTenantId(e.target.value)}
              aria-label={t("tenants.title")}
            >
              {me.tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
            {tenantId && (
              <Link href={`/t/${tenantId}/usage`} className="btn btn-ghost">
                {t("nav.usage")}
              </Link>
            )}
          </div>
        )}
        <CreateTenantForm
          onCreated={async (id) => {
            setTenantId(id);
            await loadMe();
          }}
        />
      </section>

      {tenantId && <BotsSection key={tenantId} tenantId={tenantId} />}
    </div>
  );
}

function CreateTenantForm({ onCreated }: { onCreated: (id: string) => Promise<void> }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = new FormData(form).get("name");
    setBusy(true);
    try {
      const { tenant } = await api<{ tenant: { id: string } }>("/v1/tenants", {
        method: "POST",
        body: { name },
      });
      form.reset();
      await onCreated(tenant.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={onSubmit}>
      <label className="flex flex-col gap-1 text-sm">
        {t("tenants.name")}
        <input className="input" name="name" required maxLength={120} />
      </label>
      <button className="btn" type="submit" disabled={busy}>
        {t("tenants.create")}
      </button>
    </form>
  );
}

function BotsSection({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const load = useCallback(async () => {
    const data = await api<{ bots: Bot[] }>(`/v1/tenants/${tenantId}/bots`);
    setBots(data.bots);
  }, [tenantId]);

  useEffect(() => {
    void load();
    void api<{ available: Pack[] }>("/v1/catalog/packs").then((d) => setPacks(d.available));
    void api<{ languages: Language[] }>("/v1/catalog/languages").then((d) =>
      setLanguages(d.languages.filter((l) => l.tier !== "owner")),
    );
  }, [load]);

  return (
    <section className="card flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t("bots.title")}</h2>
        {bots && <span className="muted text-sm">{t("bots.count", { count: bots.length })}</span>}
      </div>

      {bots === null ? (
        <p className="muted">{t("common.loading")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {bots.map((bot) => (
            <li key={bot.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <Link
                href={`/t/${tenantId}/bots/${bot.id}`}
                className="text-start font-medium underline-offset-4 hover:underline"
              >
                {bot.name}
              </Link>
              <span className="muted text-sm">
                {packs.find((p) => p.slug === bot.pack)?.name ?? bot.pack} · {t(`bots.status.${bot.status}`)}{" "}
                · {bot.languages.join(", ")}
                {bot.hostedPageEnabled && ` · ${t("bots.webOn")}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <CreateBotForm tenantId={tenantId} packs={packs} languages={languages} onCreated={load} />
    </section>
  );
}

function CreateBotForm({
  tenantId,
  packs,
  languages,
  onCreated,
}: {
  tenantId: string;
  packs: Pack[];
  languages: Language[];
  onCreated: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [pack, setPack] = useState("restaurant");
  const [chosen, setChosen] = useState<string[]>(["en", "fr"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const variants = packs.find((p) => p.slug === pack)?.variants ?? [];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/tenants/${tenantId}/bots`, {
        method: "POST",
        body: {
          name: data.get("name"),
          pack,
          variant: data.get("variant") || null,
          languages: chosen,
          hostedPageEnabled: data.get("webVersion") === "on",
        },
      });
      form.reset();
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (code: string) =>
    setChosen((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));

  return (
    <form className="flex flex-col gap-4 border-t border-[var(--border)] pt-4" onSubmit={onSubmit}>
      <h3 className="font-medium">{t("bots.create")}</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          {t("bots.name")}
          <input className="input" name="name" required maxLength={80} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("bots.pack")}
          <select className="input" value={pack} onChange={(e) => setPack(e.target.value)}>
            {packs.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {variants.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            &nbsp;
            <select className="input" name="variant" defaultValue="">
              <option value="">—</option>
              {variants.map((v) => (
                <option key={v.slug} value={v.slug}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="muted -mt-2 text-xs">{t("bots.packHint")}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm">{t("bots.languages")}</legend>
        <div className="flex flex-wrap gap-2">
          {languages.map((lang) => (
            <label
              key={lang.code}
              className="flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-sm"
              title={lang.englishName}
            >
              <input
                type="checkbox"
                checked={chosen.includes(lang.code)}
                onChange={() => toggle(lang.code)}
              />
              <span dir={lang.dir}>{lang.nativeName}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="webVersion" />
        {t("bots.webVersion")}
      </label>
      {error && (
        <p className="error text-sm" role="alert">
          {error}
        </p>
      )}
      <div>
        <button className="btn" type="submit" disabled={busy || chosen.length === 0}>
          {t("bots.create")}
        </button>
      </div>
    </form>
  );
}
