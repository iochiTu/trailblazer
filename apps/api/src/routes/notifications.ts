import { notificationPrefs, pushDevices } from "@traiblazer/db";
import { notificationPausedSchema, notificationPrefsSchema, registerDeviceSchema } from "@traiblazer/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { requireUser } from "../plugins/auth.js";

const DEFAULT_PREFS = {
  events: {},
  quietStart: null,
  quietEnd: null,
  timeZone: null,
  urgentInQuietHours: true,
  paused: false,
};

/**
 * Push notifications for the owner app and the portal in a browser (PLAN §20):
 *   GET    /v1/push/config                  the public Web Push key (null: browsers can't subscribe)
 *   POST   /v1/me/devices                   register this phone or browser for pushes
 *   DELETE /v1/me/devices/:deviceId         stop pushes to it (turning notifications off)
 *   GET    /v1/me/notification-prefs        which events, quiet hours
 *   PUT    /v1/me/notification-prefs        (everything but the pause)
 *   PATCH  /v1/me/notification-prefs        { paused }: the big on/off switch at the top of the app
 *
 * A device belongs to the sign-in (session) that registered it: signing out removes it, so a
 * phone that was handed on stops getting the business's notifications. The same token
 * registered again (every app start) moves to the current user and session.
 */
export async function notificationRoutes(app: FastifyInstance, { db, config }: AppContext) {
  app.get("/v1/push/config", async () => ({ webPushPublicKey: config.VAPID_PUBLIC_KEY ?? null }));

  app.post("/v1/me/devices", { preHandler: requireUser }, async (request, reply) => {
    const user = request.user!;
    const input = registerDeviceSchema.parse(request.body);
    const values = {
      userId: user.id,
      sessionId: user.sessionId,
      platform: input.platform,
      token: input.token,
      keys: input.platform === "web" ? input.keys : null,
      appVersion: input.appVersion ?? null,
      lastSeenAt: new Date(),
    };
    const [device] = await db
      .insert(pushDevices)
      .values(values)
      .onConflictDoUpdate({ target: pushDevices.token, set: values })
      .returning({ id: pushDevices.id, platform: pushDevices.platform });
    return reply.code(201).send({ device });
  });

  app.delete<{ Params: { deviceId: string } }>(
    "/v1/me/devices/:deviceId",
    { preHandler: requireUser },
    async (request, reply) => {
      const { deviceId } = request.params;
      if (!isUuid(deviceId)) throw notFound("Device");
      const [gone] = await db
        .delete(pushDevices)
        .where(and(eq(pushDevices.id, deviceId), eq(pushDevices.userId, request.user!.id)))
        .returning({ id: pushDevices.id });
      if (!gone) throw notFound("Device");
      return reply.code(204).send();
    },
  );

  app.get("/v1/me/notification-prefs", { preHandler: requireUser }, async (request) => {
    const [row] = await db
      .select()
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, request.user!.id))
      .limit(1);
    if (!row) return { prefs: DEFAULT_PREFS };
    const { userId: _, updatedAt: __, ...prefs } = row;
    return { prefs };
  });

  app.put("/v1/me/notification-prefs", { preHandler: requireUser }, async (request) => {
    const input = notificationPrefsSchema.parse(request.body);
    const values = { ...input, userId: request.user!.id, updatedAt: new Date() };
    await db
      .insert(notificationPrefs)
      .values(values)
      .onConflictDoUpdate({ target: notificationPrefs.userId, set: values });
    return { prefs: input };
  });

  // Separate from PUT so the settings form and the switch never overwrite each other.
  app.patch("/v1/me/notification-prefs", { preHandler: requireUser }, async (request) => {
    const { paused } = notificationPausedSchema.parse(request.body);
    await db
      .insert(notificationPrefs)
      .values({ userId: request.user!.id, paused })
      .onConflictDoUpdate({ target: notificationPrefs.userId, set: { paused, updatedAt: new Date() } });
    return { paused };
  });
}
