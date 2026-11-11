import { type ChatStreamEvent, runChat, syncSource } from "@traiblazer/core";
import {
  bots,
  businessProfiles,
  catalogItems,
  type Db,
  knowledgeSources,
  leads,
  tenants,
  withTenant,
} from "@traiblazer/db";
import type { EmbeddingProvider, LLMGateway } from "@traiblazer/llm";
import { eq, inArray } from "drizzle-orm";
import { score } from "./score.js";
import type { CaseResult, EvalBusiness, EvalCase, Outcome } from "./types.js";

export interface EvalDeps {
  db: Db;
  gateway: LLMGateway;
  embeddings?: EmbeddingProvider | null;
}

interface SetUp {
  tenantId: string;
  botId: string;
}

/**
 * Creates a business of its own for the run (a tenant with one assistant, its profile, services and
 * pasted text, indexed like any knowledge source). Removed again by `removeBusinesses`.
 */
export async function setUpBusiness(deps: EvalDeps, business: EvalBusiness): Promise<SetUp> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [tenant] = await deps.db
    .insert(tenants)
    .values({ name: `Eval: ${business.profile.businessName}`, slug: `eval-${business.key}-${suffix}` })
    .returning({ id: tenants.id });
  const tenantId = tenant!.id;
  const sourceIds = await withTenant(deps.db, tenantId, async (tx) => {
    const [bot] = await tx
      .insert(bots)
      .values({
        tenantId,
        name: `${business.profile.businessName} assistant`,
        pack: business.pack,
        variant: business.variant,
        status: "active",
        languages: ["en", "fr"],
        defaultLanguage: "en",
      })
      .returning({ id: bots.id });
    const botId = bot!.id;
    const { address, ...profile } = business.profile;
    await tx.insert(businessProfiles).values({ tenantId, botId, ...profile, address: { full: address } });
    if (business.catalog.length) {
      await tx
        .insert(catalogItems)
        .values(business.catalog.map((item, position) => ({ tenantId, botId, position, ...item })));
    }
    const sources = await tx
      .insert(knowledgeSources)
      .values(
        business.knowledge.map((k) => ({
          tenantId,
          botId,
          type: "text" as const,
          title: k.title,
          content: k.content,
        })),
      )
      .returning({ id: knowledgeSources.id });
    return { botId, ids: sources.map((s) => s.id) };
  });
  for (const id of sourceIds.ids) {
    await syncSource({ db: deps.db, embeddings: deps.embeddings ?? null }, tenantId, id);
  }
  return { tenantId, botId: sourceIds.botId };
}

/** Deletes the run's businesses and everything they hold (conversations, requests, usage). */
export async function removeBusinesses(db: Db, tenantIds: string[]): Promise<void> {
  if (tenantIds.length) await db.delete(tenants).where(inArray(tenants.id, tenantIds));
}

/** Plays a case's conversation through the chat engine and gathers what the visitor saw. */
export async function playCase(deps: EvalDeps, business: SetUp, evalCase: EvalCase): Promise<Outcome> {
  const visitorId = `eval-${crypto.randomUUID()}`;
  let conversationId: string | null = null;
  let urgency: Outcome["urgency"] = null;
  const outcome: Outcome = {
    reply: "",
    urgency: null,
    advice: false,
    unanswered: false,
    actions: [],
    tools: [],
    requests: [],
    error: null,
    firstTextMs: null,
    totalMs: 0,
  };

  const savedRequests = async () => {
    if (!conversationId) return [];
    const id = conversationId;
    return withTenant(deps.db, business.tenantId, (tx) =>
      tx
        .select({ kind: leads.kind, urgent: leads.urgent, details: leads.details })
        .from(leads)
        .where(eq(leads.conversationId, id)),
    );
  };

  const turns = [...evalCase.turns];
  for (let index = 0; index < turns.length; index++) {
    const message = turns[index]!;
    const started = performance.now();
    let reply = "";
    let firstText: number | null = null;
    let done: Extract<ChatStreamEvent, { type: "done" }> | null = null;
    try {
      for await (const event of runChat(
        { db: deps.db, gateway: deps.gateway, embeddings: deps.embeddings ?? null },
        {
          tenantId: business.tenantId,
          botId: business.botId,
          conversationId,
          visitorId,
          // Tests by the owner: no notifications, no knowledge gaps, requests never sent on.
          channel: "playground",
          message,
        },
      )) {
        if (event.type === "start") conversationId = event.conversationId;
        else if (event.type === "text") {
          firstText ??= performance.now() - started;
          reply += event.text;
        } else if (event.type === "reset") reply = "";
        else if (event.type === "urgent") urgency = higher(urgency, event.level);
        else if (event.type === "error") outcome.error = `${event.code}: ${event.message}`;
        else if (event.type === "done") done = event;
      }
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : String(error);
    }
    if (done?.flags.urgency) urgency = higher(urgency, done.flags.urgency);
    if (done?.flags.error || done?.flags.busy) outcome.error ??= done.flags.busy ? "busy" : "failed";
    if (outcome.error) break;
    // A visitor asked for more details than the case gave answers them once, like a real one.
    if (index === turns.length - 1 && index === evalCase.turns.length - 1 && evalCase.moreDetails) {
      if (!(await savedRequests()).length) turns.push(evalCase.moreDetails);
    }
    if (index === turns.length - 1) {
      outcome.reply = reply;
      outcome.firstTextMs = firstText === null ? null : Math.round(firstText);
      outcome.totalMs = Math.round(performance.now() - started);
      outcome.advice = Boolean(done?.flags.advice);
      outcome.unanswered = Boolean(done?.flags.unanswered);
      outcome.actions = (done?.flags.actions ?? []).map((a) => a.kind);
      outcome.tools = done?.flags.tools ?? [];
    }
  }
  outcome.urgency = urgency;

  outcome.requests = await savedRequests();
  return outcome;
}

const higher = (a: Outcome["urgency"], b: Outcome["urgency"]) =>
  a === "danger" || b === "danger" ? "danger" : (a ?? b);

/**
 * Runs the cases (each `repeat` times) against fresh test businesses and scores them. The
 * businesses are removed afterwards, also when a run fails.
 */
export async function runEvals(
  deps: EvalDeps,
  cases: EvalCase[],
  businesses: Record<string, EvalBusiness>,
  options: { repeat?: number; onResult?: (result: CaseResult, done: number, total: number) => void } = {},
): Promise<CaseResult[]> {
  const repeat = Math.max(1, options.repeat ?? 1);
  const created = new Map<string, SetUp>();
  const results: CaseResult[] = [];
  const total = cases.length * repeat;
  try {
    for (const key of new Set(cases.map((c) => c.business))) {
      const business = businesses[key];
      if (!business) throw new Error(`Unknown test business "${key}"`);
      created.set(key, await setUpBusiness(deps, business));
    }
    for (let run = 1; run <= repeat; run++) {
      for (const evalCase of cases) {
        const outcome = await playCase(deps, created.get(evalCase.business)!, evalCase);
        const failures = score(evalCase, outcome);
        const result = { case: evalCase, run, outcome, passed: failures.length === 0, failures };
        results.push(result);
        options.onResult?.(result, results.length, total);
      }
    }
  } finally {
    await removeBusinesses(
      deps.db,
      [...created.values()].map((b) => b.tenantId),
    );
  }
  return results;
}
