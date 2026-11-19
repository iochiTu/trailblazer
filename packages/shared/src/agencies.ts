import { z } from "zod";

/** Agencies (resellers): what agencies and operators may send (docs/AGENCY.md). */

const httpsUrl = z
  .url({ protocol: /^https$/ })
  .max(500)
  .refine((u) => !/\s/.test(u), "Invalid address");

/** ISO 4217 code, stored lower-case like Stripe's. */
export const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Use a 3-letter currency code")
  .transform((c) => c.toLowerCase());

export const agencyBillingModeSchema = z.enum(["client_pays", "agency_pays"]);
const billingMode = agencyBillingModeSchema;

/** A signed-in user applies to become a partner agency (they become its owner). */
export const agencyApplicationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  website: httpsUrl.optional(),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Use a 2-letter country code")
    .transform((c) => c.toUpperCase()),
  currency: currencyCode.default("cad"),
  note: z.string().trim().max(2000).optional(),
});

export const agencyBrandingSchema = z
  .object({
    logoUrl: httpsUrl.nullable(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Use a color like #1f6f5c")
      .nullable(),
    supportEmail: z.email().max(254).nullable(),
    website: httpsUrl.nullable(),
    poweredBy: z.enum(["none", "agency"]),
  })
  .partial();

export const agencyClientUpdateSchema = z.object({ status: z.enum(["active", "suspended"]) }).partial();

export const agencyMemberSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  role: z.enum(["admin", "member"]),
});

/** The client's owner: an existing account, added by email. */
export const agencyClientOwnerSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
});

export const operatorAgencyUpdateSchema = z
  .object({
    status: z.enum(["active", "suspended", "declined"]),
    currency: currencyCode,
    sharePercent: z.number().int().min(0).max(100).nullable(),
    billingModes: z
      .array(billingMode)
      .min(1)
      .transform((list) => [...new Set(list)]),
    trialClientCap: z.number().int().min(0).max(10_000),
    payoutsHeld: z.boolean(),
  })
  .partial();
