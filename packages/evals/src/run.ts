import { type ChatStreamEvent, embedChunks, handleInboundText, runChat, syncSource } from "@traiblazer/core";
import {
  bots,
  businessProfiles,
  catalogItems,
  conversations,
  type Db,
  knowledgeSources,
  leads,
  type MessageFlags,
  messages,
  outboundMessages,
  tenants,
  withTenant,
} from "@traiblazer/db";
import type { EmbeddingProvider, LLMGateway, QueryEmbedder } from "@traiblazer/llm";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { score } from "./score.js";
import type { CaseResult, EvalBusiness, EvalCase, Outcome } from "./types.js";

export interface EvalDeps {
  db: Db;
  gateway: LLMGateway;
  /** Embeds the businesses' text when set (search by meaning). */
  embeddings?: EmbeddingProvider | null;
  /** Embeds the visitors' questions, like the API does. */
  queryEmbeddings?: QueryEmbedder | null;
}

interface SetUp {
  tenantId: string;
  botId: string;
}

/**
 * Creates a business of its own for the run (a tenant with one assistant, its profile, services and
 * pasted text, indexed like any knowledge source). Removed again by `removeBusinesses`.
 */
export async function setUpBusiness(
  deps: Pick<EvalDeps, "db" | "embeddings">,
  business: EvalBusiness,
): Promise<SetUp> {
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
  try {
    for (const id of sourceIds.ids) await syncSource({ db: deps.db }, tenantId, id);
    // What the worker's embed.chunks job does, right away.
    if (deps.embeddings) {
      await embedChunks({ db: deps.db, embeddings: deps.embeddings }, tenantId, sourceIds.botId);
    }
  } catch (error) {
    // Not handed back to the caller yet, so nobody else would remove it.
    await removeBusinesses(deps.db, [tenantId]);
    throw error;
  }
  return { tenantId, botId: sourceIds.botId };
}

/** Deletes the run's businesses and everything they hold (conversations, requests, usage). */
export async function removeBusinesses(db: Db, tenantIds: string[]): Promise<void> {
  if (tenantIds.length) await db.delete(tenants).where(inArray(tenants.id, tenantIds));
}

/** The assistant's number in SMS cases; nothing is sent to or from it. */
const SMS_NUMBER = "+18075550100";

/**
 * Plays a case by text message: each turn goes through the whole SMS path (STOP and HELP, limits,
 * the assistant, plain-text conversion). The texts it writes are kept, never sent.
 */
async function playSmsCase(deps: EvalDeps, business: SetUp, evalCase: EvalCase): Promise<Outcome> {
  const sender = `+1807555${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const number = { ...business, e164: SMS_NUMBER };
  const outcome: Outcome = {
    reply: "",
    urgency: null,
    advice: false,
    unanswered: false,
    actions: [],
    itemButtons: [],
    tools: [],
    requests: [],
    error: null,
    firstTextMs: null,
    totalMs: 0,
    sms: { sender, outcomes: [], texts: [] },
  };
  const read = () =>
    withTenant(deps.db, business.tenantId, async (tx) => ({
      texts: await tx
        .select({ body: outboundMessages.body })
        .from(outboundMessages)
        .where(and(eq(outboundMessages.botId, business.botId), eq(outboundMessages.toNumber, sender)))
        .orderBy(asc(outboundMessages.createdAt)),
      requests: await tx
        .select({
          kind: leads.kind,
          urgent: leads.urgent,
          details: leads.details,
          itemName: leads.itemName,
          phone: leads.phone,
          conversationId: leads.conversationId,
        })
        .from(leads)
        .where(and(eq(leads.botId, business.botId), eq(leads.phone, sender))),
      flags: await tx
        .select({ flags: messages.flags })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(
          and(
            eq(conversations.botId, business.botId),
            eq(conversations.visitorId, sender),
            eq(messages.role, "assistant"),
          ),
        )
        .orderBy(desc(messages.createdAt)),
    }));

  const turns = [...evalCase.turns];
  for (let index = 0; index < turns.length; index++) {
    const started = performance.now();
    const before = (await read()).texts.length;
    try {
      const result = await handleInboundText(
        { db: deps.db, gateway: deps.gateway, embeddings: deps.queryEmbeddings ?? null, holdTexts: true },
        number,
        { from: sender, text: turns[index]! },
      );
      outcome.sms!.outcomes.push(result);
      if (result === "failed" || result === "unavailable") outcome.error = result;
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : String(error);
    }
    const now = await read();
    if (outcome.error) break;
    // A customer asked for more details than the case gave answers once, like a real one.
    if (index === turns.length - 1 && index === evalCase.turns.length - 1 && evalCase.moreDetails) {
      if (!now.requests.length) turns.push(evalCase.moreDetails);
    }
    if (index === turns.length - 1) {
      outcome.reply = now.texts.slice(before).at(-1)?.body ?? "";
      outcome.totalMs = Math.round(performance.now() - started);
    }
  }

  const end = await read();
  outcome.sms!.texts = end.texts.map((t) => t.body);
  outcome.requests = end.requests;
  const all = end.flags.map((f) => f.flags as MessageFlags);
  const last = all[0];
  outcome.urgency = all.some((f) => f.urgency === "danger")
    ? "danger"
    : all.some((f) => f.urgency === "urgent")
      ? "urgent"
      : null;
  outcome.advice = Boolean(last?.advice);
  outcome.unanswered = Boolean(last?.unanswered);
  outcome.actions = (last?.actions ?? []).map((a) => a.kind);
  outcome.itemButtons = (last?.actions ?? []).flatMap((a) =>
    a.item ? [{ kind: a.kind, item: a.item.name }] : [],
  );
  outcome.tools = last?.tools ?? [];
  return outcome;
}

/** Plays a case's conversation through the chat engine and gathers what the visitor saw. */
export async function playCase(deps: EvalDeps, business: SetUp, evalCase: EvalCase): Promise<Outcome> {
  if (evalCase.channel === "sms") return playSmsCase(deps, business, evalCase);
  const visitorId = `eval-${crypto.randomUUID()}`;
  let conversationId: string | null = null;
  let urgency: Outcome["urgency"] = null;
  const outcome: Outcome = {
    reply: "",
    urgency: null,
    advice: false,
    unanswered: false,
    actions: [],
    itemButtons: [],
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
        .select({ kind: leads.kind, urgent: leads.urgent, details: leads.details, itemName: leads.itemName })
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
        { db: deps.db, gateway: deps.gateway, embeddings: deps.queryEmbeddings ?? null },
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
      outcome.itemButtons = (done?.flags.actions ?? []).flatMap((a) =>
        a.item ? [{ kind: a.kind, item: a.item.name }] : [],
      );
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
