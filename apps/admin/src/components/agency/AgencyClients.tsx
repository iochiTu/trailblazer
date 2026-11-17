"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { rememberTenant } from "@/components/app/useMe";
import { type Agency, type AgencyBillingMode, type AgencyClient, ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Message = { kind: "ok" | "error"; text: string } | null;

/** The agency's clients: create one, open it, suspend it, give it an owner. */
export function AgencyClients({ agency }: { agency: Agency }) {
  const { t, language } = useI18n();
  const router = useRouter();
  const [clients, setClients] = useState<AgencyClient[] | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [ownerFor, setOwnerFor] = useState<string | null>(null);
  const base = `/v1/agencies/${agency.id}`;
  const canManage = agency.role !== "member" && agency.status === "active";
  const canOpen = agency.status === "active";

  const load = useCallback(async () => {
    const data = await api<{ clients: AgencyClient[] }>(`${base}/clients`);
    setClients(data.clients);
  }, [base]);

  useEffect(() => {
    load().catch(() => setClients([]));
  }, [load]);

  const fail = (err: unknown) =>
    setMessage({
      kind: "error",
      text: err instanceof ApiError && err.status < 500 ? err.message : t("common.error"),
    });

  function open(client: AgencyClient) {
    rememberTenant(client.id);
    router.push("/dashboard");
  }

  async function setStatus(client: AgencyClient, status: "active" | "suspended") {
    if (status === "suspended" && !window.confirm(t("agency.clients.suspendConfirm", { name: client.name })))
      return;
    setMessage(null);
    try {
      await api(`${base}/clients/${client.id}`, { method: "PATCH", body: { status } });
      await load();
    } catch (err) {
      fail(err);
    }
  }

  async function addOwner(event: FormEvent<HTMLFormElement>, client: AgencyClient) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setMessage(null);
    try {
      await api(`${base}/clients/${client.id}/owner`, { method: "POST", body: { email } });
      setOwnerFor(null);
      setMessage({ kind: "ok", text: t("agency.clients.ownerAdded", { email, name: client.name }) });
      await load();
    } catch (err) {
      fail(err);
    }
  }

  const num = (n: number) => new Intl.NumberFormat(`${language}-CA`).format(n);
  const q = query.trim().toLowerCase();
  const shown = (clients ?? []).filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.owners.some((email) => email.includes(q)),
  );

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <NewClientForm
          agency={agency}
          onCreated={async (name) => {
            setMessage({ kind: "ok", text: t("agency.clients.created", { name }) });
            await load();
          }}
          onError={fail}
        />
      )}
      {message && (
        <p
          className={message.kind === "error" ? "error text-sm" : "text-sm"}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
      <div className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">{t("agency.tab.clients")}</h2>
          <input
            className="input max-w-xs"
            type="search"
            placeholder={t("agency.clients.search")}
            aria-label={t("agency.clients.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {!clients ? (
          <p className="muted">{t("common.loading")}</p>
        ) : clients.length === 0 ? (
          <p className="muted text-sm">{t("agency.clients.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="muted text-left">
                <tr>
                  <th className="py-2 pr-4 font-normal">{t("agency.clients.name")}</th>
                  <th className="py-2 pr-4 font-normal">{t("agency.clients.plan")}</th>
                  <th className="py-2 pr-4 text-right font-normal">{t("agency.clients.questions")}</th>
                  <th className="py-2 pr-4 font-normal">{t("agency.clients.owner")}</th>
                  <th className="py-2 font-normal">{t("agency.clients.status")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} className="border-t border-[var(--border)] align-top">
                    <td className="py-3 pr-4">
                      <div className="font-medium">{c.name}</div>
                      <div className="muted text-xs">{t(`agency.mode.${c.billingMode}`)}</div>
                      {canOpen && (
                        <button
                          type="button"
                          className="btn btn-ghost mt-2 px-3 py-1 text-xs"
                          onClick={() => open(c)}
                        >
                          {t("agency.clients.open")}
                        </button>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {c.planName ? c.planName[language === "fr" ? "fr" : "en"] : c.plan}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums">
                      {num(c.questions)} / {num(c.monthlyLimit)}
                    </td>
                    <td className="py-3 pr-4">
                      {c.owners.length ? (
                        <span className="break-all">{c.owners.join(", ")}</span>
                      ) : (
                        <span className="muted">{t("agency.clients.noOwner")}</span>
                      )}
                      {canManage && c.owners.length === 0 && ownerFor !== c.id && (
                        <div>
                          <button
                            type="button"
                            className="btn-text mt-1 text-xs"
                            onClick={() => setOwnerFor(c.id)}
                          >
                            {t("agency.clients.addOwner")}
                          </button>
                        </div>
                      )}
                      {ownerFor === c.id && (
                        <form
                          className="mt-2 flex flex-wrap items-end gap-2"
                          onSubmit={(e) => addOwner(e, c)}
                        >
                          <label className="flex flex-col gap-1 text-xs">
                            {t("agency.clients.ownerEmail")}
                            <input className="input" type="email" name="email" required maxLength={254} />
                          </label>
                          <button className="btn px-3 py-1 text-xs" type="submit">
                            {t("agency.clients.addOwner")}
                          </button>
                          <button
                            className="btn btn-ghost px-3 py-1 text-xs"
                            type="button"
                            onClick={() => setOwnerFor(null)}
                          >
                            {t("common.cancel")}
                          </button>
                        </form>
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex flex-col items-start gap-2">
                        <span className={c.status === "suspended" ? "error text-xs font-medium" : "text-xs"}>
                          {c.status === "suspended"
                            ? c.suspendedBy === "operator"
                              ? t("agency.clients.suspendedByUs")
                              : t("agency.status.suspended")
                            : t("agency.status.active")}
                        </span>
                        {canManage && c.suspendedBy !== "operator" && (
                          <button
                            type="button"
                            className="btn btn-ghost px-2 py-1 text-xs"
                            onClick={() =>
                              void setStatus(c, c.status === "suspended" ? "active" : "suspended")
                            }
                          >
                            {c.status === "suspended"
                              ? t("agency.clients.reactivate")
                              : t("agency.clients.suspend")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function NewClientForm({
  agency,
  onCreated,
  onError,
}: {
  agency: Agency;
  onCreated: (name: string) => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<AgencyBillingMode>(agency.billingModes[0] ?? "client_pays");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    setBusy(true);
    try {
      await api(`/v1/agencies/${agency.id}/clients`, { method: "POST", body: { name, billingMode: mode } });
      form.reset();
      await onCreated(name);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card flex flex-col gap-4 p-5" onSubmit={onSubmit} aria-labelledby="agency-new-client">
      <h2 id="agency-new-client" className="text-lg font-medium">
        {t("agency.clients.new")}
      </h2>
      <label className="flex max-w-md flex-col gap-1 text-sm">
        {t("agency.clients.name")}
        <input className="input" name="name" required maxLength={120} />
      </label>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1">{t("agency.clients.mode")}</legend>
        {agency.billingModes.map((m) => (
          <label key={m} className="flex items-start gap-2">
            <input
              type="radio"
              name="billingMode"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{t(`agency.mode.${m}`)}</span>
              <span className="muted block text-xs">{t(`agency.mode.${m}.help`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <button className="btn" type="submit" disabled={busy} aria-busy={busy}>
          {t("agency.clients.create")}
        </button>
      </div>
    </form>
  );
}
