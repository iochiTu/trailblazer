"use client";

import { type FormEvent, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { type OperatorPlan, PACK_PHASES, type Policies } from "@/lib/operator";

const LIMIT_FIELDS = [
  {
    key: "visitorDailyLimit",
    label: "Questions per visitor per day",
    help: "Default for every business; owners can set their own.",
    min: 1,
    max: 1000,
  },
  {
    key: "conversationMaxQuestions",
    label: "Questions per conversation",
    help: "After this, the visitor is asked to start a new conversation.",
    min: 2,
    max: 500,
  },
  {
    key: "chatIpPerMinute",
    label: "Chat messages per IP per minute",
    help: "Flood protection across all businesses.",
    min: 1,
    max: 600,
  },
] as const;

export function PoliciesTab() {
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [plans, setPlans] = useState<OperatorPlan[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ policies: Policies }>("/v1/operator/policies"),
      api<{ plans: OperatorPlan[] }>("/v1/operator/plans"),
    ])
      .then(([p, list]) => {
        setPolicies(p.policies);
        setPlans(list.plans);
      })
      .catch(() => setMessage({ kind: "error", text: "Couldn't load policies." }));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policies) return;
    const data = new FormData(event.currentTarget);
    const next: Policies = {
      defaultPlan: String(data.get("defaultPlan")),
      visitorDailyLimit: Number(data.get("visitorDailyLimit")),
      conversationMaxQuestions: Number(data.get("conversationMaxQuestions")),
      chatIpPerMinute: Number(data.get("chatIpPerMinute")),
      releasedPackPhase: Number(data.get("releasedPackPhase")),
      maxBusinessesPerAccount: Number(data.get("maxBusinessesPerAccount")),
    };
    const changed = Object.fromEntries(
      Object.entries(next).filter(([k, v]) => policies[k as keyof Policies] !== v),
    ) as Partial<Policies>;
    if (Object.keys(changed).length === 0) {
      setMessage({ kind: "ok", text: "Nothing changed." });
      return;
    }
    if (
      changed.releasedPackPhase !== undefined &&
      changed.releasedPackPhase < policies.releasedPackPhase &&
      !window.confirm(
        "Hide industries from new assistants? Existing assistants keep working, but businesses can't pick these industries anymore.",
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ policies: Policies }>("/v1/operator/policies", {
        method: "PATCH",
        body: changed,
      });
      setPolicies(res.policies);
      setMessage({ kind: "ok", text: "Policies saved. They apply on every server within 30 seconds." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Couldn't save." });
    } finally {
      setBusy(false);
    }
  }

  if (!policies) return message ? <p className="error">{message.text}</p> : <p className="muted">Loading…</p>;

  return (
    <form className="card flex max-w-3xl flex-col gap-6 p-5" onSubmit={onSubmit}>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-lg font-medium">New businesses</legend>
        <label className="flex flex-col gap-1 text-sm">
          Default plan
          <select className="input max-w-sm" name="defaultPlan" defaultValue={policies.defaultPlan}>
            {plans
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameEn}
                </option>
              ))}
          </select>
          <span className="muted text-xs">Plan a business gets when it signs up.</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Industries available
          <select className="input" name="releasedPackPhase" defaultValue={policies.releasedPackPhase}>
            {Object.entries(PACK_PHASES).map(([phase, label]) => (
              <option key={phase} value={phase}>
                {label}
              </option>
            ))}
          </select>
          <span className="muted text-xs">
            Which industry packs businesses can choose for new assistants.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Businesses per account
          <input
            className="input max-w-[10rem]"
            type="number"
            name="maxBusinessesPerAccount"
            required
            min={1}
            max={100}
            defaultValue={policies.maxBusinessesPerAccount}
          />
          <span className="muted text-xs">
            How many businesses one account can own. Each new business starts on the default plan, so this
            stops one account from collecting free allowances. Shown on the public portal.
          </span>
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-lg font-medium">Abuse limits</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {LIMIT_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-sm">
              {f.label}
              <input
                className="input"
                type="number"
                name={f.key}
                required
                min={f.min}
                max={f.max}
                defaultValue={policies[f.key]}
              />
              <span className="muted text-xs">{f.help}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {message && (
        <p className={message.kind === "error" ? "error text-sm" : "text-sm"} role="status">
          {message.text}
        </p>
      )}
      <div>
        <button className="btn" type="submit" disabled={busy}>
          Save policies
        </button>
      </div>
    </form>
  );
}
