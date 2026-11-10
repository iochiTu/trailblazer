import { getAddon } from "@traiblazer/addons";
import {
  botAddons,
  bots,
  businessProfiles,
  type Db,
  leads,
  memberships,
  tenants,
  users,
  withTenant,
} from "@traiblazer/db";
import { getTemplate } from "@traiblazer/industry-packs";
import { and, eq, inArray } from "drizzle-orm";
import type { Mailer } from "../addons/effects.js";

export interface UrgentAlertPayload {
  botId: string;
  leadId: string;
}

export interface UrgentAlertDeps {
  db: Db;
  mailer: Mailer;
  /** Admin portal origin, for the link to the request. */
  adminUrl?: string;
}

const TEXT = {
  en: {
    subject: (business: string, name: string) => `URGENT: ${name} needs help now (${business})`,
    intro:
      "A visitor described an urgent problem to your assistant. Please call them back as soon as you can.",
    name: "Name",
    phone: "Phone",
    email: "Email",
    bestTime: "Best time",
    request: "Request",
    photos: (n: number) => `${n} photo${n === 1 ? "" : "s"} attached to the request.`,
    open: "Open the request",
    footer:
      "Urgent requests are always emailed right away: to the Email notifications address when that add-on is on, otherwise to the business's owners and admins.",
  },
  fr: {
    subject: (business: string, name: string) => `URGENT : ${name} a besoin d'aide maintenant (${business})`,
    intro:
      "Un visiteur a décrit un problème urgent à votre assistant. Veuillez le rappeler dès que possible.",
    name: "Nom",
    phone: "Téléphone",
    email: "Courriel",
    bestTime: "Meilleur moment",
    request: "Demande",
    photos: (n: number) => `${n} photo${n === 1 ? "" : "s"} jointe${n === 1 ? "" : "s"} à la demande.`,
    open: "Ouvrir la demande",
    footer:
      "Les demandes urgentes sont toujours envoyées tout de suite : à l'adresse du module Notifications par courriel s'il est activé, sinon aux propriétaires et administrateurs de l'entreprise.",
  },
};

/**
 * Emails the business about an urgent request (PLAN §4.2 "Urgent request flag"), queued with high
 * priority by the chat engine. It goes to the Email notifications add-on's address when that
 * add-on is on, otherwise to the business's owners and admins, so an urgent request never waits
 * for someone to open the portal.
 */
export async function runUrgentAlert(
  deps: UrgentAlertDeps,
  tenantId: string,
  payload: UrgentAlertPayload,
): Promise<"done" | "skipped"> {
  const found = await withTenant(deps.db, tenantId, async (tx) => {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, payload.leadId), eq(leads.botId, payload.botId)))
      .limit(1);
    if (!lead?.urgent || lead.channel === "playground") return null;
    const [bot] = await tx
      .select({ name: bots.name, pack: bots.pack, variant: bots.variant })
      .from(bots)
      .where(eq(bots.id, payload.botId))
      .limit(1);
    const [profile] = await tx
      .select({ businessName: businessProfiles.businessName })
      .from(businessProfiles)
      .where(eq(businessProfiles.botId, payload.botId))
      .limit(1);
    const [addon] = await tx
      .select({ enabled: botAddons.enabled, config: botAddons.config })
      .from(botAddons)
      .where(and(eq(botAddons.botId, payload.botId), eq(botAddons.addonId, "email-notifications")))
      .limit(1);
    const [tenant] = await tx
      .select({ ownerLanguage: tenants.ownerLanguage })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const staff = await tx
      .select({ email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.role, ["owner", "admin"])));
    return { lead, bot, profile, addon, tenant, staff };
  });
  if (!found?.bot) return "skipped";
  const { lead, bot, profile, addon, tenant, staff } = found;

  const configured = addon?.enabled && getAddon("email-notifications")?.schema.safeParse(addon.config).data;
  const addonEmail = (configured as { email?: string } | undefined)?.email;
  const to = addonEmail ? [addonEmail] : [...new Set(staff.map((s) => s.email))];
  if (!to.length) return "skipped";

  const lang = tenant?.ownerLanguage === "fr" ? "fr" : "en";
  const t = TEXT[lang];
  const business = profile?.businessName ?? bot.name;
  const fields = getTemplate(bot.pack, bot.variant).leadFields;
  const line = (label: string, value: string | null | undefined) => (value ? `${label}: ${value}` : null);
  const link = deps.adminUrl ? `${deps.adminUrl}/t/${tenantId}/bots/${payload.botId}?tab=requests` : null;
  const text = [
    t.intro,
    "",
    line(t.name, lead.name),
    line(t.phone, lead.phone),
    line(t.email, lead.email),
    line(t.bestTime, lead.bestTime),
    ...fields.map((f) => line(f.label[lang], lead.details[f.key])),
    line(t.request, lead.message),
    lead.attachmentIds.length ? t.photos(lead.attachmentIds.length) : null,
    "",
    link ? `${t.open}: ${link}` : null,
    "",
    "—",
    t.footer,
  ]
    .filter((l) => l !== null)
    .join("\n");
  await deps.mailer.send({ to, subject: t.subject(business, lead.name.slice(0, 60)), text });
  return "done";
}
