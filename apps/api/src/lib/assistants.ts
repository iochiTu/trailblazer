import { botKeys, bots, businessProfiles, type Tx } from "@traiblazer/db";
import { getTemplate } from "@traiblazer/industry-packs";
import { newPublicKey, toOrigin } from "./ids.js";

/**
 * Creates an assistant in the caller's tenant transaction: the assistant with its industry
 * template's guidelines and workflows copied in (the business then edits its own copy), its
 * business profile and its public key. Used when a business adds an assistant and when operators
 * build a prospect demo.
 */
export async function createAssistant(
  tx: Tx,
  input: {
    tenantId: string;
    name: string;
    pack: string;
    variant?: string | null;
    languages: string[];
    defaultLanguage: string;
    hostedPageEnabled?: boolean;
    allowedOrigins?: string[];
    /** Shown in greetings and on the page until the profile is filled in. */
    businessName: string | null;
    websiteUrl?: string | null;
    /** Live keys in production, test keys elsewhere. */
    live: boolean;
  },
) {
  const template = getTemplate(input.pack, input.variant);
  const [bot] = await tx
    .insert(bots)
    .values({
      tenantId: input.tenantId,
      name: input.name,
      pack: input.pack,
      variant: input.variant ?? null,
      guidelines: template.guidelines,
      workflows: template.workflows,
      languages: input.languages,
      defaultLanguage: input.defaultLanguage,
      hostedPageEnabled: input.hostedPageEnabled ?? false,
    })
    .returning();
  const [profile] = await tx
    .insert(businessProfiles)
    .values({
      tenantId: input.tenantId,
      botId: bot!.id,
      businessName: input.businessName,
      websiteUrl: input.websiteUrl ?? null,
    })
    .returning();
  const [key] = await tx
    .insert(botKeys)
    .values({
      tenantId: input.tenantId,
      botId: bot!.id,
      publicKey: newPublicKey(input.live),
      allowedOrigins: [...new Set((input.allowedOrigins ?? []).map(toOrigin))],
    })
    .returning();
  return { bot: bot!, profile: profile!, key: key! };
}
