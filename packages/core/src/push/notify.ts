import {
  bots,
  businessProfiles,
  type Db,
  leadComments,
  leads,
  memberships,
  type NotificationEvent,
  notificationPrefs,
  notifications,
  pushDevices,
  sessions,
  users,
  withTenant,
} from "@traiblazer/db";
import { enOrFr } from "@traiblazer/i18n";
import type { PushMessage, PushOutcome, PushSender } from "@traiblazer/push";
import { and, eq, gt, inArray } from "drizzle-orm";
import { businessNameOf } from "../business.js";

/** Who to tell about what (PLAN §20.4). */
export interface PushNotifyPayload {
  event: NotificationEvent;
  botId: string;
  leadId: string;
  /** For request.comment: the comment, and the person who wrote it (not notified). */
  commentId?: string;
  actorUserId?: string;
}

export type { PushMessage, PushOutcome, PushSender, PushTarget } from "@traiblazer/push";

export interface PushNotifyDeps {
  db: Db;
  push: PushSender;
  /** For tests: the current time (quiet hours). */
  now?: () => Date;
}

const TEXT = {
  en: {
    urgentTitle: (business: string) => `Urgent request · ${business}`,
    urgentBody: "A customer needs help now. Tap to call them back.",
    newTitle: (business: string) => `New request · ${business}`,
    newBody: {
      callback: "Someone asked you to call them back.",
      quote: "Someone asked for a quote.",
      booking: "Someone booked or asked for an appointment.",
      question: "Someone left a question for you.",
      complaint: "Someone left a complaint.",
      other: "Someone left a request.",
    },
    commentTitle: (business: string) => `New note · ${business}`,
    commentBody: (author: string) => `${author} added a note to a request.`,
    someone: "Someone on your team",
  },
  fr: {
    urgentTitle: (business: string) => `Demande urgente · ${business}`,
    urgentBody: "Un client a besoin d'aide maintenant. Touchez pour le rappeler.",
    newTitle: (business: string) => `Nouvelle demande · ${business}`,
    newBody: {
      callback: "Quelqu'un vous demande de le rappeler.",
      quote: "Quelqu'un demande une soumission.",
      booking: "Quelqu'un a pris ou demandé un rendez-vous.",
      question: "Quelqu'un vous a laissé une question.",
      complaint: "Quelqu'un a laissé une plainte.",
      other: "Quelqu'un a laissé une demande.",
    },
    commentTitle: (business: string) => `Nouvelle note · ${business}`,
    commentBody: (author: string) => `${author} a ajouté une note à une demande.`,
    someone: "Quelqu'un de votre équipe",
  },
};

/** Minutes after midnight for "HH:MM", or null when it isn't one. */
function minutesOf(hhmm: string | null): number | null {
  const m = hhmm ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Whether `at` falls in the quiet hours [start, end) in `timeZone`. A range that wraps past
 * midnight (22:00–07:00) is quiet from start to midnight and from midnight to end. An equal start
 * and end, a missing value or an unknown time zone means no quiet hours.
 */
export function inQuietHours(
  prefs: { quietStart: string | null; quietEnd: string | null; timeZone: string | null },
  at: Date,
): boolean {
  const start = minutesOf(prefs.quietStart);
  const end = minutesOf(prefs.quietEnd);
  if (start === null || end === null || start === end) return false;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: prefs.timeZone ?? "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
  } catch {
    return false;
  }
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  const now = hour * 60 + minute;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/**
 * Sends the push notifications for one event (PLAN §20.4), queued by the chat engine (a new or
 * urgent request) or the API (a note on a request). Everyone in the business is told, except the
 * person who wrote the note, unless they turned that event off or it's their quiet hours (urgent
 * requests come through quiet hours unless they said otherwise). Each person's outcome is kept in
 * `notifications`; devices whose token is no longer valid are forgotten.
 */
export async function runPushNotify(
  deps: PushNotifyDeps,
  tenantId: string,
  payload: PushNotifyPayload,
): Promise<{ sent: number; skipped: number; failed: number } | "skipped"> {
  const now = deps.now?.() ?? new Date();
  const found = await withTenant(deps.db, tenantId, async (tx) => {
    const [lead] = await tx
      .select({ id: leads.id, kind: leads.kind, channel: leads.channel, urgent: leads.urgent })
      .from(leads)
      .where(and(eq(leads.id, payload.leadId), eq(leads.botId, payload.botId)))
      .limit(1);
    // The owner's own test chat never notifies.
    if (!lead || lead.channel === "playground") return null;
    if (payload.event === "request.comment") {
      const [comment] = payload.commentId
        ? await tx
            .select({ id: leadComments.id })
            .from(leadComments)
            .where(and(eq(leadComments.id, payload.commentId), eq(leadComments.leadId, lead.id)))
            .limit(1)
        : [];
      if (!comment) return null;
    }
    const [bot] = await tx.select({ name: bots.name }).from(bots).where(eq(bots.id, payload.botId)).limit(1);
    const [profile] = await tx
      .select({ businessName: businessProfiles.businessName })
      .from(businessProfiles)
      .where(eq(businessProfiles.botId, payload.botId))
      .limit(1);
    const members = await tx
      .select({ userId: users.id, name: users.name, uiLanguage: users.uiLanguage })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.tenantId, tenantId));
    return { lead, bot, profile, members };
  });
  if (!found?.bot) return "skipped";
  const { lead, bot, profile, members } = found;

  const author = members.find((m) => m.userId === payload.actorUserId);
  const recipients = members.filter((m) => m.userId !== payload.actorUserId);
  if (!recipients.length) return { sent: 0, skipped: 0, failed: 0 };
  const ids = recipients.map((m) => m.userId);
  // Devices of signed-in sessions only: signing out stops the pushes.
  const devices = await deps.db
    .select({
      id: pushDevices.id,
      userId: pushDevices.userId,
      platform: pushDevices.platform,
      token: pushDevices.token,
      keys: pushDevices.keys,
    })
    .from(pushDevices)
    .innerJoin(sessions, eq(sessions.id, pushDevices.sessionId))
    .where(and(inArray(pushDevices.userId, ids), gt(sessions.expiresAt, now)));
  const prefs = await deps.db.select().from(notificationPrefs).where(inArray(notificationPrefs.userId, ids));

  const business = businessNameOf(bot, profile);
  const urgent = payload.event === "request.urgent";
  const url = `/t/${tenantId}/inbox/${payload.botId}/${lead.id}`;
  const messageFor = (language: string): PushMessage => {
    const t = TEXT[enOrFr(language)];
    const authorName = author?.name.split(/\s+/)[0] || t.someone;
    const [title, body] =
      payload.event === "request.urgent"
        ? [t.urgentTitle(business), t.urgentBody]
        : payload.event === "request.new"
          ? [t.newTitle(business), t.newBody[lead.kind] ?? t.newBody.other]
          : [t.commentTitle(business), t.commentBody(authorName)];
    return { title, body, url, tag: `request-${lead.id}`, urgent };
  };

  const log: (typeof notifications.$inferInsert)[] = [];
  const gone: string[] = [];
  const totals = { sent: 0, skipped: 0, failed: 0 };
  for (const member of recipients) {
    const entry = {
      tenantId,
      userId: member.userId,
      event: payload.event,
      botId: payload.botId,
      leadId: lead.id,
    };
    const pref = prefs.find((p) => p.userId === member.userId);
    const mine = devices.filter((d) => d.userId === member.userId);
    const skip = (reason: string) => {
      totals.skipped++;
      log.push({ ...entry, status: "skipped", reason });
    };
    if (pref?.events[payload.event] === false) {
      skip("turned_off");
      continue;
    }
    if (pref && inQuietHours(pref, now) && !(urgent && pref.urgentInQuietHours)) {
      skip("quiet_hours");
      continue;
    }
    if (!mine.length) {
      skip("no_device");
      continue;
    }
    const message = messageFor(member.uiLanguage);
    let reached = 0;
    const errors: string[] = [];
    for (const device of mine) {
      const outcome = await deps.push
        .send({ platform: device.platform, token: device.token, keys: device.keys }, message)
        .catch((error: unknown): PushOutcome => ({ status: "failed", error: String(error) }));
      if (outcome.status === "sent") reached++;
      else if (outcome.status === "gone") gone.push(device.id);
      else if (outcome.status === "failed") errors.push(outcome.error);
      else errors.push(`no ${device.platform} push provider configured`);
    }
    if (reached) {
      totals.sent++;
      log.push({ ...entry, status: "sent", devices: reached });
    } else if (errors.length) {
      totals.failed++;
      log.push({ ...entry, status: "failed", reason: errors.join("; ").slice(0, 500) });
    } else skip("no_device");
  }

  if (gone.length) await deps.db.delete(pushDevices).where(inArray(pushDevices.id, gone));
  if (log.length) await withTenant(deps.db, tenantId, (tx) => tx.insert(notifications).values(log));
  return totals;
}
