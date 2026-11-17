"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { type Agency, type AgencyRole, ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface Member {
  userId: string;
  name: string;
  email: string;
  role: AgencyRole;
  since: string;
}

/** The agency's own users. Only the owner adds and removes them. */
export function AgencyTeam({ agency, me }: { agency: Agency; me: string }) {
  const { t } = useI18n();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [role, setRole] = useState<"admin" | "member">("member");
  const base = `/v1/agencies/${agency.id}/members`;
  const isOwner = agency.role === "owner";

  const load = useCallback(async () => {
    setMembers((await api<{ members: Member[] }>(base)).members);
  }, [base]);

  useEffect(() => {
    load().catch(() => setMembers([]));
  }, [load]);

  const fail = (err: unknown) =>
    setMessage({
      kind: "error",
      text: err instanceof ApiError && err.status < 500 ? err.message : t("common.error"),
    });

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    setMessage(null);
    try {
      await api(base, { method: "POST", body: { email, role } });
      form.reset();
      setMessage({ kind: "ok", text: t("agency.team.added", { email }) });
      await load();
    } catch (err) {
      fail(err);
    }
  }

  async function remove(member: Member) {
    if (!window.confirm(t("agency.team.removeConfirm", { name: member.name }))) return;
    setMessage(null);
    try {
      await api(`${base}/${member.userId}`, { method: "DELETE" });
      await load();
    } catch (err) {
      fail(err);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {isOwner && (
        <form className="card flex flex-col gap-4 p-5" onSubmit={add} aria-labelledby="agency-add-member">
          <h2 id="agency-add-member" className="text-lg font-medium">
            {t("agency.team.add")}
          </h2>
          <label className="flex max-w-md flex-col gap-1 text-sm">
            {t("agency.team.email")}
            <input className="input" type="email" name="email" required maxLength={254} />
          </label>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1">{t("agency.team.role")}</legend>
            {(["member", "admin"] as const).map((r) => (
              <label key={r} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="role"
                  value={r}
                  checked={role === r}
                  onChange={() => setRole(r)}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">{t(`agency.team.role.${r}`)}</span>
                  <span className="muted block text-xs">{t(`agency.team.role.${r}.help`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div>
            <button className="btn" type="submit">
              {t("agency.team.add")}
            </button>
          </div>
        </form>
      )}
      {message && (
        <p
          className={message.kind === "error" ? "error text-sm" : "text-sm"}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
      <div className="card p-5">
        {!members ? (
          <p className="muted">{t("common.loading")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{m.name}</p>
                  <p className="muted break-all text-sm">{m.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="badge">{t(`agency.team.role.${m.role}`)}</span>
                  {isOwner && m.role !== "owner" && m.userId !== me && (
                    <button
                      type="button"
                      className="btn btn-ghost px-3 py-1 text-xs"
                      onClick={() => void remove(m)}
                    >
                      {t("agency.team.remove")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
