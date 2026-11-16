import {
  bots,
  businessProfiles,
  createDb,
  type DbHandle,
  leadComments,
  leads,
  memberships,
  notificationPrefs,
  notifications,
  pushDevices,
  runMigrations,
  sessions,
  tenants,
  users,
  withTenant,
} from "@traiblazer/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  inQuietHours,
  type PushMessage,
  type PushOutcome,
  type PushTarget,
  runPushNotify,
} from "./notify.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;

let owner: DbHandle;
let app: DbHandle;
let tenantId: string;
let botId: string;
let leadId: string;
const userIds: Record<"sam" | "jo" | "lee", string> = { sam: "", jo: "", lee: "" };

/** Records what would have been sent; a token starting with "gone" is no longer valid. */
class FakePush {
  sent: { target: PushTarget; message: PushMessage }[] = [];
  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    if (target.token.startsWith("gone")) return { status: "gone" };
    if (target.token.startsWith("down")) return { status: "failed", error: "provider down" };
    this.sent.push({ target, message });
    return { status: "sent" };
  }
}

async function addDevice(
  userId: string,
  token: string,
  platform: "ios" | "android" | "web",
  expired = false,
) {
  const [session] = await owner.db
    .insert(sessions)
    .values({
      userId,
      tokenHash: `hash-${crypto.randomUUID()}`,
      expiresAt: new Date(Date.now() + (expired ? -1 : 1) * 86_400_000),
    })
    .returning();
  await owner.db.insert(pushDevices).values({ userId, sessionId: session!.id, platform, token });
}

beforeAll(async () => {
  await runMigrations(ownerUrl);
  owner = createDb(ownerUrl, { max: 1 });
  app = createDb(appUrl, { max: 2 });
  const suffix = crypto.randomUUID().slice(0, 8);
  const [t] = await owner.db
    .insert(tenants)
    .values({ name: "Smith Plumbing", slug: `push-${suffix}` })
    .returning();
  tenantId = t!.id;
  for (const [key, name, lang] of [
    ["sam", "Sam Smith", "en"],
    ["jo", "Jo Tremblay", "fr"],
    ["lee", "Lee Park", "en"],
  ] as const) {
    const [u] = await owner.db
      .insert(users)
      .values({ email: `${key}-${suffix}@push.example`, name, passwordHash: "x", uiLanguage: lang })
      .returning();
    userIds[key] = u!.id;
    await owner.db
      .insert(memberships)
      .values({ tenantId, userId: u!.id, role: key === "sam" ? "owner" : "editor" });
  }
  const [b] = await owner.db
    .insert(bots)
    .values({ tenantId, name: "Smith bot", pack: "trades", variant: "plumbing" })
    .returning();
  botId = b!.id;
  await owner.db.insert(businessProfiles).values({ tenantId, botId, businessName: "Smith & Sons Plumbing" });
  const [lead] = await owner.db
    .insert(leads)
    .values({
      tenantId,
      botId,
      channel: "hosted",
      kind: "quote",
      name: "Alex Doe",
      phone: "519-555-0142",
      message: "Leaking water heater",
      urgent: true,
    })
    .returning();
  leadId = lead!.id;
});

beforeEach(async () => {
  await owner.db.delete(pushDevices).where(inArray(pushDevices.userId, Object.values(userIds)));
  await owner.db.delete(notificationPrefs).where(inArray(notificationPrefs.userId, Object.values(userIds)));
  await owner.db.delete(notifications).where(eq(notifications.tenantId, tenantId));
});

afterAll(async () => {
  await owner?.db.delete(tenants).where(eq(tenants.id, tenantId));
  await owner?.db.delete(users).where(inArray(users.id, Object.values(userIds)));
  await app?.close();
  await owner?.close();
});

describe("push notifications to the team", () => {
  it("tells everyone with a phone, in their language, without the customer's details", async () => {
    await addDevice(userIds.sam, "apns-sam", "ios");
    await addDevice(userIds.sam, "web-sam", "web");
    await addDevice(userIds.jo, "fcm-jo", "android");
    const push = new FakePush();

    const totals = await runPushNotify({ db: app.db, push }, tenantId, {
      event: "request.urgent",
      botId,
      leadId,
    });
    expect(totals).toEqual({ sent: 2, skipped: 1, failed: 0 });
    expect(push.sent.map((s) => s.target.token).sort()).toEqual(["apns-sam", "fcm-jo", "web-sam"]);
    const sam = push.sent.find((s) => s.target.token === "apns-sam")!.message;
    expect(sam).toEqual({
      title: "Urgent request · Smith & Sons Plumbing",
      body: "A customer needs help now. Tap to call them back.",
      url: `/t/${tenantId}/inbox/${botId}/${leadId}`,
      tag: `request-${leadId}`,
      urgent: true,
    });
    expect(push.sent.find((s) => s.target.token === "fcm-jo")!.message.title).toBe(
      "Demande urgente · Smith & Sons Plumbing",
    );
    expect(JSON.stringify(push.sent)).not.toMatch(/Alex|555|heater/);

    const log = await withTenant(app.db, tenantId, (tx) =>
      tx.select().from(notifications).where(eq(notifications.tenantId, tenantId)),
    );
    expect(log.map((n) => [n.userId, n.status, n.devices, n.reason]).sort()).toEqual(
      [
        [userIds.sam, "sent", 2, null],
        [userIds.jo, "sent", 1, null],
        [userIds.lee, "skipped", 0, "no_device"],
      ].sort(),
    );
  });

  it("leaves out the note's author, people who turned it off and signed-out phones", async () => {
    await addDevice(userIds.sam, "apns-sam", "ios");
    await addDevice(userIds.jo, "fcm-jo", "android");
    await addDevice(userIds.lee, "fcm-lee-old", "android", true);
    await owner.db
      .insert(notificationPrefs)
      .values({ userId: userIds.jo, events: { "request.comment": false } });
    const [comment] = await withTenant(app.db, tenantId, (tx) =>
      tx
        .insert(leadComments)
        .values({ tenantId, botId, leadId, authorUserId: userIds.sam, body: "Called, coming Tuesday" })
        .returning(),
    );
    const push = new FakePush();
    const totals = await runPushNotify({ db: app.db, push }, tenantId, {
      event: "request.comment",
      botId,
      leadId,
      commentId: comment!.id,
      actorUserId: userIds.sam,
    });
    expect(totals).toEqual({ sent: 0, skipped: 2, failed: 0 });
    expect(push.sent).toEqual([]);

    // A note that was deleted before the job ran sends nothing.
    expect(
      await runPushNotify({ db: app.db, push }, tenantId, {
        event: "request.comment",
        botId,
        leadId,
        commentId: crypto.randomUUID(),
        actorUserId: userIds.sam,
      }),
    ).toBe("skipped");
  });

  it("keeps quiet hours, except for urgent requests", async () => {
    await addDevice(userIds.sam, "apns-sam", "ios");
    await owner.db.insert(notificationPrefs).values({
      userId: userIds.sam,
      quietStart: "22:00",
      quietEnd: "07:00",
      timeZone: "Etc/GMT+5",
    });
    // 03:00 today at UTC-5 (while the test sessions are signed in).
    const at = new Date();
    at.setUTCHours(8, 0, 0, 0);
    const now = () => at;
    const push = new FakePush();
    await runPushNotify({ db: app.db, push, now }, tenantId, { event: "request.new", botId, leadId });
    expect(push.sent).toEqual([]);
    await runPushNotify({ db: app.db, push, now }, tenantId, { event: "request.urgent", botId, leadId });
    expect(push.sent).toHaveLength(1);

    await owner.db
      .update(notificationPrefs)
      .set({ urgentInQuietHours: false })
      .where(eq(notificationPrefs.userId, userIds.sam));
    await runPushNotify({ db: app.db, push, now }, tenantId, { event: "request.urgent", botId, leadId });
    expect(push.sent).toHaveLength(1);
  });

  it("forgets devices whose token is no longer valid and records failures", async () => {
    await addDevice(userIds.sam, "gone-sam", "ios");
    await addDevice(userIds.jo, "down-jo", "android");
    const totals = await runPushNotify({ db: app.db, push: new FakePush() }, tenantId, {
      event: "request.new",
      botId,
      leadId,
    });
    expect(totals).toEqual({ sent: 0, skipped: 2, failed: 1 });
    const left = await owner.db
      .select({ token: pushDevices.token })
      .from(pushDevices)
      .where(inArray(pushDevices.userId, Object.values(userIds)));
    expect(left).toEqual([{ token: "down-jo" }]);
    const [failed] = await withTenant(app.db, tenantId, (tx) =>
      tx.select().from(notifications).where(eq(notifications.status, "failed")),
    );
    expect(failed).toMatchObject({ userId: userIds.jo, reason: "provider down" });
  });

  it("never notifies about the owner's own test chat", async () => {
    await addDevice(userIds.sam, "apns-sam", "ios");
    const [test] = await owner.db
      .insert(leads)
      .values({ tenantId, botId, channel: "playground", kind: "callback", name: "Me", message: "test" })
      .returning();
    const push = new FakePush();
    expect(
      await runPushNotify({ db: app.db, push }, tenantId, { event: "request.new", botId, leadId: test!.id }),
    ).toBe("skipped");
    expect(push.sent).toEqual([]);
  });
});

describe("quiet hours", () => {
  const prefs = { quietStart: "22:00", quietEnd: "07:00", timeZone: "Etc/GMT+8" };
  it("wraps past midnight in the user's time zone", () => {
    // 23:30 and 06:59 at UTC-8 are quiet; 07:00 and noon are not.
    expect(inQuietHours(prefs, new Date("2026-12-02T07:30:00Z"))).toBe(true);
    expect(inQuietHours(prefs, new Date("2026-12-02T14:59:00Z"))).toBe(true);
    expect(inQuietHours(prefs, new Date("2026-12-02T15:00:00Z"))).toBe(false);
    expect(inQuietHours(prefs, new Date("2026-12-02T20:00:00Z"))).toBe(false);
  });
  it("handles a range within one day and ignores incomplete settings", () => {
    const lunch = { quietStart: "12:00", quietEnd: "13:00", timeZone: "UTC" };
    expect(inQuietHours(lunch, new Date("2026-12-02T12:30:00Z"))).toBe(true);
    expect(inQuietHours(lunch, new Date("2026-12-02T13:00:00Z"))).toBe(false);
    expect(inQuietHours({ ...lunch, quietEnd: null }, new Date("2026-12-02T12:30:00Z"))).toBe(false);
    expect(inQuietHours({ ...lunch, timeZone: "Not/AZone" }, new Date("2026-12-02T12:30:00Z"))).toBe(false);
  });
});
