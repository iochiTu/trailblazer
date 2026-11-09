"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { fmtCad, fmtNumber, type OperatorPlan } from "@/lib/operator";

type PlanForm = Omit<OperatorPlan, "businesses" | "active">;

const NUMBER_FIELDS = [
  {
    key: "monthlyQuestions",
    label: "Questions / month",
    help: "Visitor questions answered per calendar month.",
  },
  { key: "perMinute", label: "Questions / minute", help: "All visitors of one business together." },
  { key: "concurrent", label: "Answers at once", help: "Answers generated at the same time." },
  { key: "knowledgeImages", label: "Photos / assistant", help: "Business photos in the knowledge base." },
  { key: "sortOrder", label: "Sort order", help: "Lower comes first." },
] as const;

function readForm(form: HTMLFormElement): Partial<PlanForm> {
  const data = new FormData(form);
  const num = (k: string) => Number(data.get(k));
  const price = String(data.get("price") ?? "").trim();
  return {
    ...(data.has("id") ? { id: String(data.get("id")).trim() } : {}),
    nameEn: String(data.get("nameEn")).trim(),
    nameFr: String(data.get("nameFr")).trim(),
    monthlyQuestions: num("monthlyQuestions"),
    perMinute: num("perMinute"),
    concurrent: num("concurrent"),
    knowledgeImages: num("knowledgeImages"),
    sortOrder: num("sortOrder"),
    priceMonthlyCents: price === "" ? null : Math.round(Number(price) * 100),
  };
}

function PlanFields({ plan, isNew }: { plan?: OperatorPlan; isNew?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {isNew && (
        <label className="flex flex-col gap-1 text-sm">
          Plan ID
          <input
            className="input"
            name="id"
            required
            pattern="[a-z0-9_]{2,40}"
            title="Lowercase letters, digits and _"
            placeholder="e.g. seasonal"
          />
          <span className="muted text-xs">Permanent. Lowercase, digits, _</span>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        Name (English)
        <input className="input" name="nameEn" required maxLength={60} defaultValue={plan?.nameEn} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Name (French)
        <input className="input" name="nameFr" required maxLength={60} defaultValue={plan?.nameFr} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Price / month (CAD)
        <input
          className="input"
          name="price"
          type="number"
          min={0}
          step="0.01"
          placeholder="Not shown"
          defaultValue={plan?.priceMonthlyCents == null ? "" : plan.priceMonthlyCents / 100}
        />
      </label>
      {NUMBER_FIELDS.map((f) => (
        <label key={f.key} className="flex flex-col gap-1 text-sm">
          {f.label}
          <input
            className="input"
            name={f.key}
            type="number"
            required
            min={f.key === "sortOrder" || f.key === "knowledgeImages" ? 0 : 1}
            defaultValue={
              plan ? plan[f.key] : f.key === "sortOrder" ? 50 : f.key === "knowledgeImages" ? 50 : undefined
            }
          />
          <span className="muted text-xs">{f.help}</span>
        </label>
      ))}
    </div>
  );
}

export function PlansTab() {
  const [plans, setPlans] = useState<OperatorPlan[] | null>(null);
  const [defaultPlan, setDefaultPlan] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [list, { policies }] = await Promise.all([
      api<{ plans: OperatorPlan[] }>("/v1/operator/plans"),
      api<{ policies: { defaultPlan: string } }>("/v1/operator/policies"),
    ]);
    setPlans(list.plans);
    setDefaultPlan(policies.defaultPlan);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, ok: string) {
    setMessage(null);
    try {
      await action();
      setMessage({ kind: "ok", text: ok });
      await load();
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Couldn't save." });
      return false;
    }
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = readForm(event.currentTarget);
    if (
      await run(() => api("/v1/operator/plans", { method: "POST", body }), `Plan "${body.nameEn}" created.`)
    ) {
      setAdding(false);
    }
  }

  async function onSave(event: FormEvent<HTMLFormElement>, plan: OperatorPlan) {
    event.preventDefault();
    const body = readForm(event.currentTarget);
    const lowered = body.monthlyQuestions! < plan.monthlyQuestions && plan.businesses > 0;
    if (
      lowered &&
      !window.confirm(
        `Lower the monthly allowance for ${plan.businesses} business(es) on ${plan.nameEn}? It applies right away.`,
      )
    ) {
      return;
    }
    if (
      await run(
        () => api(`/v1/operator/plans/${plan.id}`, { method: "PATCH", body }),
        `${body.nameEn} saved.`,
      )
    ) {
      setEditing(null);
    }
  }

  const setActive = (plan: OperatorPlan, active: boolean) =>
    run(
      () => api(`/v1/operator/plans/${plan.id}`, { method: "PATCH", body: { active } }),
      active ? `${plan.nameEn} can be assigned again.` : `${plan.nameEn} archived.`,
    );

  if (!plans) return <p className="muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="muted max-w-2xl text-sm">
          Changes apply to every business on the plan within 30 seconds. Archived plans keep working for the
          businesses already on them but can't be assigned.
        </p>
        {!adding && (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            Add plan
          </button>
        )}
      </div>
      {message && (
        <p className={message.kind === "error" ? "error text-sm" : "text-sm"} role="status">
          {message.text}
        </p>
      )}

      {adding && (
        <form className="card flex flex-col gap-4 p-5" onSubmit={onCreate}>
          <h2 className="text-lg font-medium">New plan</h2>
          <PlanFields isNew />
          <div className="flex gap-2">
            <button className="btn" type="submit">
              Create plan
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {plans.map((plan) =>
        editing === plan.id ? (
          <form key={plan.id} className="card flex flex-col gap-4 p-5" onSubmit={(e) => void onSave(e, plan)}>
            <h2 className="text-lg font-medium">
              Edit {plan.nameEn} <span className="muted text-sm font-normal">({plan.id})</span>
            </h2>
            <PlanFields plan={plan} />
            <div className="flex gap-2">
              <button className="btn" type="submit">
                Save
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div
            key={plan.id}
            className={`card flex flex-wrap items-center gap-4 p-4 ${plan.active ? "" : "opacity-70"}`}
          >
            <div className="min-w-48 flex-1">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                {plan.nameEn}
                <span className="muted text-xs font-normal">
                  {plan.id} · {plan.nameFr}
                </span>
                {plan.id === defaultPlan && (
                  <span className="badge badge-accent">Default for new businesses</span>
                )}
                {!plan.active && <span className="badge">Archived</span>}
              </div>
              <div className="muted mt-1 text-sm">
                {fmtCad(plan.priceMonthlyCents)}/mo · {fmtNumber(plan.monthlyQuestions)} questions/mo ·{" "}
                {fmtNumber(plan.perMinute)}/min · {fmtNumber(plan.concurrent)} at once ·{" "}
                {fmtNumber(plan.knowledgeImages)} photos · {fmtNumber(plan.businesses)} business
                {plan.businesses === 1 ? "" : "es"}
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(plan.id)}>
                Edit
              </button>
              {plan.active ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={plan.id === defaultPlan}
                  title={plan.id === defaultPlan ? "Choose another default plan first (Policies)" : undefined}
                  onClick={() => void setActive(plan, false)}
                >
                  Archive
                </button>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={() => void setActive(plan, true)}>
                  Restore
                </button>
              )}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
