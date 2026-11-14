import {
  bots,
  businessProfiles,
  type Db,
  jobs,
  memberships,
  phoneNumbers,
  type Tx,
  tenants,
  usageEvents,
  users,
  withTenant,
} from "@traiblazer/db";
import { formatPhone } from "@traiblazer/telephony";
import { and, eq, gte, inArray, like, or, sql } from "drizzle-orm";
import type { Mailer } from "../addons/effects.js";
import { JOB_TYPES } from "../jobs.js";
import { queueText } from "./queue.js";

/**
 * The daily spend cap and texts to the business's owner (docs/PHONE_AND_SMS.md §8). The cap counts
 * what texts (and later calls) on an assistant's number cost in the last 24 hours, from the usage
 * records the worker writes when it sends.
 */

const hoursAgo = (now: Date, hours: number) => new Date(now.getTime() - hours * 3600_000);

/** What the assistant's number cost in the last 24 hours, in millionths of a dollar. */
export async function phoneSpendMicros(tx: Tx, botId: string, now: Date): Promise<number> {
  const [row] = await tx
    .select({ micros: sql<string>`coalesce(sum(${usageEvents.costMicros}), 0)` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.botId, botId),
        or(eq(usageEvents.kind, "sms"), eq(usageEvents.kind, "mms"), like(usageEvents.kind, "voice.%")),
        gte(usageEvents.createdAt, hoursAgo(now, 24)),
      ),
    );
  return Number(row?.micros ?? 0);
}

export interface PhoneBudget {
  /** The assistant's number row. */
  number: typeof phoneNumbers.$inferSelect;
  spentMicros: number;
  /** Spending in the last 24 hours has reached the cap. */
  capped: boolean;
}

/** The assistant's number with what it spent today, or null when it has no number. */
export async function phoneBudget(tx: Tx, botId: string, now: Date): Promise<PhoneBudget | null> {
  const [number] = await tx.select().from(phoneNumbers).where(eq(phoneNumbers.botId, botId)).limit(1);
  if (!number) return null;
  const spentMicros = await phoneSpendMicros(tx, botId, now);
  return { number, spentMicros, capped: spentMicros >= number.dailyCapCents * 10_000 };
}

const TEXT = {
  en: {
    kind: {
      callback: "callback",
      quote: "quote",
      booking: "booking",
      question: "question",
      complaint: "complaint",
      other: "request",
    } as Record<string, string>,
    request: (business: string, kind: string, urgent: boolean) =>
      `${business}: ${urgent ? "URGENT " : "new "}${kind} request`,
    from: "from",
    about: "About",
    capText: (business: string, cap: string) =>
      `${business}: your assistant reached today's limit for text messages (${cap}) and stopped answering texts. It starts again as the last 24 hours' use drops. Raise the limit on the Phone & texts tab.`,
    capSubject: (business: string) => `Text message limit reached for today (${business})`,
    capBody: (business: string, cap: string, spent: string) =>
      [
        `The assistant for ${business} has used ${spent} on text messages in the last 24 hours, which reaches the daily limit of ${cap}.`,
        "",
        "Until that amount drops below the limit again, the assistant doesn't answer text messages and doesn't text callers back. Texts customers send are still kept in Conversations, and the chat on your page works as usual.",
        "",
        "You can raise the daily limit on the assistant's Phone & texts tab.",
      ].join("\n"),
    open: "Open the Phone & texts tab",
  },
  fr: {
    kind: {
      callback: "rappel",
      quote: "soumission",
      booking: "réservation",
      question: "question",
      complaint: "plainte",
      other: "demande",
    } as Record<string, string>,
    request: (business: string, kind: string, urgent: boolean) =>
      `${business} : ${urgent ? "URGENT, " : "nouvelle "}demande (${kind})`,
    from: "de",
    about: "Au sujet de",
    capText: (business: string, cap: string) =>
      `${business} : votre assistant a atteint la limite du jour pour les messages texte (${cap}) et ne répond plus aux textos. Il reprend quand l'utilisation des 24 dernières heures diminue. Augmentez la limite dans l'onglet Téléphone et textos.`,
    capSubject: (business: string) => `Limite de messages texte atteinte pour aujourd'hui (${business})`,
    capBody: (business: string, cap: string, spent: string) =>
      [
        `L'assistant de ${business} a utilisé ${spent} en messages texte dans les 24 dernières heures, ce qui atteint la limite quotidienne de ${cap}.`,
        "",
        "Tant que ce montant ne redescend pas sous la limite, l'assistant ne répond pas aux messages texte et ne texte pas les appelants. Les textos des clients restent dans Conversations, et le clavardage de votre page fonctionne comme d'habitude.",
        "",
        "Vous pouvez augmenter la limite quotidienne dans l'onglet Téléphone et textos de l'assistant.",
      ].join("\n"),
    open: "Ouvrir l'onglet Téléphone et textos",
  },
};
type Lang = keyof typeof TEXT;
const dollars = (cents: number, lang: Lang) =>
  lang === "fr" ? `${(cents / 100).toFixed(2).replace(".", ",")} $` : `$${(cents / 100).toFixed(2)}`;

async function ownerSide(tx: Tx, tenantId: string, botId: string) {
  const [row] = await tx
    .select({ name: bots.name, businessName: businessProfiles.businessName })
    .from(bots)
    .leftJoin(businessProfiles, eq(businessProfiles.botId, bots.id))
    .where(eq(bots.id, botId))
    .limit(1);
  const [tenant] = await tx
    .select({ ownerLanguage: tenants.ownerLanguage })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return {
    business: row?.businessName?.trim() || row?.name || "",
    lang: (tenant?.ownerLanguage === "fr" ? "fr" : "en") as Lang,
  };
}

const clip = (text: string, max: number) => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
};

/**
 * Texts the business's owner about a request a visitor just left (from any channel), when the
 * assistant has a number, the owner gave a mobile number for alerts and chose this kind of request.
 * Runs in the transaction that stores the answer; the text is sent by the worker.
 */
export async function textOwnerAboutRequest(
  tx: Tx,
  input: {
    tenantId: string;
    botId: string;
    request: {
      kind: string;
      name: string;
      phone: string | null;
      email: string | null;
      message: string;
      urgent: boolean;
      item?: string | null;
    };
  },
): Promise<string | null> {
  const [number] = await tx.select().from(phoneNumbers).where(eq(phoneNumbers.botId, input.botId)).limit(1);
  if (!number?.alertNumber || number.alertRequests === "off") return null;
  if (number.alertRequests === "urgent" && !input.request.urgent) return null;
  const { business, lang } = await ownerSide(tx, input.tenantId, input.botId);
  const t = TEXT[lang];
  const r = input.request;
  const contact = r.phone ?? r.email;
  const body = [
    `${t.request(business, t.kind[r.kind] ?? t.kind.other!, r.urgent)} ${t.from} ${clip(r.name, 40)}${contact ? `, ${contact}` : ""}.`,
    r.item ? `${t.about}: ${clip(r.item, 60)}.` : null,
    clip(r.message, 160),
  ]
    .filter(Boolean)
    .join(" ");
  return queueText(tx, {
    tenantId: input.tenantId,
    botId: input.botId,
    kind: "alert",
    from: number.e164,
    to: number.alertNumber,
    body,
  });
}

/**
 * The cap was reached: tells the business once per 24 hours, by text to the owner's alert number
 * (when there is one) and by an email job. Returns whether it was told now.
 */
export async function noteCapReached(tx: Tx, budget: PhoneBudget, now: Date): Promise<boolean> {
  const { number } = budget;
  if (number.capAlertedAt && number.capAlertedAt > hoursAgo(now, 24)) return false;
  await tx.update(phoneNumbers).set({ capAlertedAt: now }).where(eq(phoneNumbers.id, number.id));
  if (number.alertNumber) {
    const { business, lang } = await ownerSide(tx, number.tenantId, number.botId);
    await queueText(tx, {
      tenantId: number.tenantId,
      botId: number.botId,
      kind: "alert",
      from: number.e164,
      to: number.alertNumber,
      body: TEXT[lang].capText(business, dollars(number.dailyCapCents, lang)),
    });
  }
  await tx.insert(jobs).values({
    tenantId: number.tenantId,
    type: JOB_TYPES.phoneCapAlert,
    payload: { botId: number.botId, spentMicros: budget.spentMicros },
  });
  return true;
}

/** Emails the business's owners and admins that the daily cap was reached (job `phone.cap_alert`). */
export async function runCapAlert(
  deps: { db: Db; mailer: Mailer; adminUrl?: string },
  tenantId: string,
  payload: { botId: string; spentMicros?: number },
): Promise<"done" | "skipped"> {
  const found = await withTenant(deps.db, tenantId, async (tx) => {
    const [number] = await tx
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.botId, payload.botId))
      .limit(1);
    if (!number) return null;
    const staff = await tx
      .select({ email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.role, ["owner", "admin"])));
    return { number, staff, ...(await ownerSide(tx, tenantId, payload.botId)) };
  });
  const to = [...new Set(found?.staff.map((s) => s.email) ?? [])];
  if (!found || !to.length) return "skipped";
  const t = TEXT[found.lang];
  const cap = dollars(found.number.dailyCapCents, found.lang);
  const spent = dollars(
    Math.round((payload.spentMicros ?? found.number.dailyCapCents * 10_000) / 10_000),
    found.lang,
  );
  const link = deps.adminUrl ? `${deps.adminUrl}/t/${tenantId}/bots/${payload.botId}?tab=phone` : null;
  await deps.mailer.send({
    to,
    subject: t.capSubject(found.business),
    text: [
      t.capBody(found.business, cap, spent),
      link ? `\n${t.open}: ${link}` : null,
      `\n${formatPhone(found.number.e164)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  });
  return "done";
}
