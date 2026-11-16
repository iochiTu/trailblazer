import {
  type ContactMessageChannel,
  contactMessages,
  contacts,
  conversations,
  type Db,
  jobs,
  leads,
  messages,
  phoneNumbers,
  type Tx,
  tenants,
  users,
  withTenant,
} from "@traiblazer/db";
import { CONTACT_TEXT_MAX } from "@traiblazer/shared";
import { toE164, toSmsText } from "@traiblazer/telephony";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Mailer } from "../addons/effects.js";
import { JOB_TYPES, newJob } from "../jobs.js";
import { phoneBudget } from "../sms/alerts.js";
import { optedOut, queueText } from "../sms/queue.js";
import { currentThread } from "../sms/sms.js";

/**
 * Contacts (the owner app's Contacts tab): the people a business can follow up with. A contact is
 * made, or found again, when someone leaves a request with the assistant, texts its number or
 * calls it. The team writes to them from there: a text from the assistant's number, an email, or a
 * record of a call.
 */

export interface ContactDetails {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

const tidy = (details: ContactDetails) => ({
  name: details.name?.trim().slice(0, 120) || null,
  phone: toE164(details.phone),
  email: details.email?.trim().toLowerCase().slice(0, 254) || null,
});

/**
 * The contact these details belong to, made when there is none: found by phone number first, then
 * by email address. What the contact didn't have yet (a name, an email, a number) is filled in,
 * and what it has is kept. Returns null when there is nothing to know the person by.
 *
 * `current` is the contact a request already belongs to: it stays that request's contact unless
 * the details now point at someone else.
 */
export async function contactFor(
  tx: Tx,
  tenantId: string,
  details: ContactDetails,
  options: { current?: string | null; at?: Date } = {},
): Promise<string | null> {
  const { name, phone, email } = tidy(details);
  const at = options.at ?? new Date();
  if (!name && !phone && !email) return options.current ?? null;

  const one = async (where: ReturnType<typeof eq>) =>
    (await tx.select().from(contacts).where(where).orderBy(asc(contacts.createdAt)).limit(1))[0];
  let found = phone ? await one(eq(contacts.phone, phone)) : undefined;
  if (!found && email) found = await one(eq(contacts.email, email));
  if (!found && options.current) found = await one(eq(contacts.id, options.current));

  if (found) {
    // A number is only given to a contact when no other contact has it (found by phone otherwise).
    await tx
      .update(contacts)
      .set({
        name: found.name ?? name,
        phone: found.phone ?? phone,
        email: found.email ?? email,
        lastActivityAt: new Date(Math.max(at.getTime(), found.lastActivityAt.getTime())),
      })
      .where(eq(contacts.id, found.id));
    return found.id;
  }

  const [made] = await tx
    .insert(contacts)
    .values({ tenantId, name, phone, email, lastActivityAt: at })
    .onConflictDoNothing()
    .returning({ id: contacts.id });
  if (made) return made.id;
  // Another request for the same number was saved at the same moment.
  return (phone && (await one(eq(contacts.phone, phone)))?.id) || null;
}

/** Someone texted or called the assistant's number: they are a contact, and were just heard from. */
export async function touchContactByPhone(tx: Tx, tenantId: string, phone: string, at: Date): Promise<void> {
  if (toE164(phone) !== phone) return;
  await contactFor(tx, tenantId, { phone }, { at });
}

/** Whether, and from which number, the team can text a contact. */
export type TextReach =
  | { ok: true; botId: string; from: string }
  | { ok: false; reason: "no_phone" | "no_number" | "opted_out" | "capped" };

/**
 * The assistant's number a text to this contact goes out from: the one they last texted or called,
 * then the one of the assistant they last left a request with, then any number the business has.
 */
export async function textReach(
  tx: Tx,
  contact: { id: string; phone: string | null },
  now = new Date(),
): Promise<TextReach> {
  if (!contact.phone) return { ok: false, reason: "no_phone" };
  const numbers = await tx
    .select({ botId: phoneNumbers.botId, e164: phoneNumbers.e164 })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.smsEnabled, true))
    .orderBy(asc(phoneNumbers.createdAt));
  if (!numbers.length) return { ok: false, reason: "no_number" };

  const [texted] = await tx
    .select({ botId: conversations.botId })
    .from(conversations)
    .where(and(eq(conversations.channel, "sms"), eq(conversations.visitorId, contact.phone)))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);
  const [asked] = await tx
    .select({ botId: leads.botId })
    .from(leads)
    .where(eq(leads.contactId, contact.id))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  const number =
    numbers.find((n) => n.botId === texted?.botId) ??
    numbers.find((n) => n.botId === asked?.botId) ??
    numbers[0]!;

  if (await optedOut(tx, number.botId, contact.phone)) return { ok: false, reason: "opted_out" };
  if ((await phoneBudget(tx, number.botId, now))?.capped) return { ok: false, reason: "capped" };
  return { ok: true, botId: number.botId, from: number.e164 };
}

export interface NewContactMessage {
  tenantId: string;
  contactId: string;
  authorUserId: string;
  channel: ContactMessageChannel;
  subject?: string | null;
  body: string;
}

export type ContactMessageResult =
  | { ok: true; message: typeof contactMessages.$inferSelect }
  | { ok: false; reason: "not_found" | "no_email" | Extract<TextReach, { ok: false }>["reason"] };

/**
 * Saves what a team member wrote to a contact and queues what has to go out: a text through the
 * assistant's number (job `message.send`), an email (job `contact.email`). A call or a note is only
 * recorded. A text is also added to the customer's text thread, so the assistant knows what was
 * said when the customer answers.
 */
export async function addContactMessage(
  tx: Tx,
  input: NewContactMessage,
  now = new Date(),
): Promise<ContactMessageResult> {
  const [contact] = await tx.select().from(contacts).where(eq(contacts.id, input.contactId)).limit(1);
  if (!contact) return { ok: false, reason: "not_found" };
  const base = {
    tenantId: input.tenantId,
    contactId: contact.id,
    authorUserId: input.authorUserId,
    channel: input.channel,
  };
  let row: typeof contactMessages.$inferSelect | undefined;

  if (input.channel === "sms") {
    const reach = await textReach(tx, contact, now);
    if (!reach.ok) return reach;
    const body = toSmsText(input.body).slice(0, CONTACT_TEXT_MAX);
    const to = contact.phone!;
    let thread: { id: string } | undefined = await currentThread(tx, reach.botId, to, now);
    if (!thread) {
      [thread] = await tx
        .insert(conversations)
        .values({
          tenantId: input.tenantId,
          botId: reach.botId,
          channel: "sms",
          visitorId: to,
          lastMessageAt: now,
        })
        .returning({ id: conversations.id });
    }
    await tx.insert(messages).values({
      tenantId: input.tenantId,
      conversationId: thread!.id,
      role: "assistant",
      content: body,
      flags: { staff: true },
    });
    await tx
      .update(conversations)
      .set({ messageCount: sql`${conversations.messageCount} + 1`, lastMessageAt: now })
      .where(eq(conversations.id, thread!.id));
    const outboundMessageId = await queueText(tx, {
      tenantId: input.tenantId,
      botId: reach.botId,
      conversationId: thread!.id,
      kind: "staff",
      from: reach.from,
      to,
      body,
    });
    [row] = await tx
      .insert(contactMessages)
      .values({ ...base, body, status: "queued", botId: reach.botId, outboundMessageId })
      .returning();
  } else if (input.channel === "email") {
    if (!contact.email) return { ok: false, reason: "no_email" };
    [row] = await tx
      .insert(contactMessages)
      .values({ ...base, subject: input.subject?.trim() || null, body: input.body, status: "queued" })
      .returning();
    await tx.insert(jobs).values(
      newJob({
        tenantId: input.tenantId,
        type: JOB_TYPES.contactEmail,
        payload: { messageId: row!.id },
        // Someone is waiting for it: ahead of crawls and embedding, like texts.
        priority: 5,
      }),
    );
  } else {
    [row] = await tx
      .insert(contactMessages)
      .values({ ...base, body: input.body })
      .returning();
  }

  await tx.update(contacts).set({ lastActivityAt: now }).where(eq(contacts.id, contact.id));
  return { ok: true, message: row! };
}

export interface ContactEmailDeps {
  db: Db;
  mailer: Mailer;
  /** False when the worker has no mail server: the email is marked failed instead of "sent". */
  mailConfigured: boolean;
}

/**
 * Sends one queued email to a contact (job `contact.email`). It goes out under the business's name
 * and answers go to the team member who wrote it. A mail server error throws, so the job is tried
 * again; `lastAttempt` marks the email failed first, so the team sees it didn't go.
 */
export async function runContactEmail(
  deps: ContactEmailDeps,
  tenantId: string,
  payload: { messageId: string },
  lastAttempt = false,
): Promise<"sent" | "skipped" | "failed"> {
  const found = await withTenant(deps.db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: contactMessages.id,
        subject: contactMessages.subject,
        body: contactMessages.body,
        to: contacts.email,
        authorName: users.name,
        authorEmail: users.email,
      })
      .from(contactMessages)
      .innerJoin(contacts, eq(contacts.id, contactMessages.contactId))
      .leftJoin(users, eq(users.id, contactMessages.authorUserId))
      .where(
        and(
          eq(contactMessages.id, payload.messageId),
          eq(contactMessages.channel, "email"),
          eq(contactMessages.status, "queued"),
        ),
      )
      .limit(1);
    return row ?? null;
  });
  if (!found) return "skipped";
  // The business's name is a platform table: read outside the tenant's rows.
  const [tenant] = await deps.db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const finish = (status: "sent" | "failed", error: string | null) =>
    withTenant(deps.db, tenantId, (tx) =>
      tx
        .update(contactMessages)
        .set({ status, error })
        .where(and(eq(contactMessages.id, found.id), isNull(contactMessages.error))),
    );

  if (!found.to) {
    await finish("failed", "no_email");
    return "failed";
  }
  if (!deps.mailConfigured) {
    await finish("failed", "not_configured");
    return "failed";
  }
  try {
    await deps.mailer.send({
      to: [found.to],
      subject: found.subject ?? tenant?.name ?? "",
      text: found.body,
      fromName: tenant?.name,
      replyTo: found.authorEmail ?? undefined,
    });
  } catch (error) {
    if (lastAttempt) await finish("failed", "send_failed");
    throw error;
  }
  await finish("sent", null);
  return "sent";
}
