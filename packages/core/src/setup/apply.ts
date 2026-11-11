import { bots, businessProfiles, catalogItems, qaPairs, type SetupSuggestion, type Tx } from "@traiblazer/db";
import { type ApplySetupInput, applySetupSchema, CATALOG_LIMIT } from "@traiblazer/shared";
import { count, eq, max } from "drizzle-orm";
import { tsvectorSql } from "../knowledge/index-documents.js";

type Bot = typeof bots.$inferSelect;

/** The services kept would take the page over its limit. */
export class CatalogLimitError extends Error {
  constructor(readonly limit: number) {
    super(`An assistant can list up to ${limit} services and products`);
  }
}

/** What was saved, for the audit log. */
export interface AppliedSetup {
  profile: string[];
  greeting: string[];
  quickReplies: string[];
  answers: number;
  services: number;
}

/**
 * Saves what was kept from a setup suggestion: business details, greeting and suggested questions
 * (for the languages the assistant offers), Q&A answers, and services and products (after the ones
 * already on the page). Runs inside the caller's tenant transaction. Used when an owner applies a
 * suggestion they reviewed, and when a prospect demo is built.
 */
export async function applySetup(
  tx: Tx,
  { tenantId, bot, input }: { tenantId: string; bot: Bot; input: ApplySetupInput },
): Promise<AppliedSetup> {
  const botId = bot.id;
  if (input.profile && Object.keys(input.profile).length) {
    await tx.update(businessProfiles).set(input.profile).where(eq(businessProfiles.botId, botId));
  }

  // Texts are kept per language, and only for languages the assistant offers.
  const offered = <T>(texts: Record<string, T> | undefined) =>
    Object.fromEntries(Object.entries(texts ?? {}).filter(([code]) => bot.languages.includes(code)));
  const greeting = offered(input.greeting);
  const quickReplies = offered(input.quickReplies);
  if (Object.keys(greeting).length || Object.keys(quickReplies).length) {
    await tx
      .update(bots)
      .set({
        settings: {
          ...bot.settings,
          greeting: { ...bot.settings.greeting, ...greeting },
          quickReplies: { ...bot.settings.quickReplies, ...quickReplies },
        },
      })
      .where(eq(bots.id, botId));
  }

  const answers = input.answers ?? [];
  if (answers.length) {
    await tx.insert(qaPairs).values(
      answers.map((pair) => {
        const language = pair.language ?? bot.defaultLanguage;
        return {
          tenantId,
          botId,
          question: pair.question,
          answer: pair.answer,
          language,
          tsv: tsvectorSql(`${pair.question}\n${pair.answer}`, language) as unknown as string,
        };
      }),
    );
  }

  // Services and products go on the business page, after the ones already there.
  const services = input.services ?? [];
  if (services.length) {
    const [listed] = await tx
      .select({ n: count(), last: max(catalogItems.position) })
      .from(catalogItems)
      .where(eq(catalogItems.botId, botId));
    if ((listed?.n ?? 0) + services.length > CATALOG_LIMIT) throw new CatalogLimitError(CATALOG_LIMIT);
    const first = (listed?.last ?? -1) + 1;
    await tx
      .insert(catalogItems)
      .values(services.map((item, index) => ({ tenantId, botId, ...item, position: first + index })));
  }

  return {
    profile: Object.keys(input.profile ?? {}),
    greeting: Object.keys(greeting),
    quickReplies: Object.keys(quickReplies),
    answers: answers.length,
    services: services.length,
  };
}

/**
 * A whole suggestion as something to apply, as if the reviewer kept everything: used for prospect
 * demos, where an operator reviews the finished page instead of the suggestion. The business name
 * is left as the operator typed it. Parts that don't fit the limits are dropped, never the lot.
 */
export function suggestionToInput(suggestion: SetupSuggestion): ApplySetupInput {
  const { profile } = suggestion;
  const candidate = {
    profile: {
      ...(profile.phone ? { phone: profile.phone } : {}),
      ...(profile.email ? { email: profile.email } : {}),
      ...(profile.websiteUrl ? { websiteUrl: profile.websiteUrl } : {}),
      ...(profile.address ? { address: { full: profile.address } } : {}),
      ...(profile.hours ? { hours: profile.hours } : {}),
      ...(profile.description ? { description: profile.description } : {}),
    },
    greeting: suggestion.greeting,
    quickReplies: suggestion.quickReplies,
    services: (suggestion.services ?? []).map((item) => ({
      kind: item.kind,
      name: item.name,
      description: item.description ?? null,
      priceText: item.priceText ?? null,
      category: item.category ?? null,
    })),
  };
  const input: ApplySetupInput = {};
  for (const part of ["greeting", "quickReplies", "services"] as const) {
    const parsed = applySetupSchema.safeParse({ [part]: candidate[part] });
    if (parsed.success) Object.assign(input, parsed.data);
  }
  // Business details one by one, so one odd value (say, a malformed email) doesn't lose the rest.
  for (const [field, value] of Object.entries(candidate.profile)) {
    const parsed = applySetupSchema.safeParse({ profile: { [field]: value } });
    if (parsed.success) input.profile = { ...input.profile, ...parsed.data.profile };
  }
  return input;
}
