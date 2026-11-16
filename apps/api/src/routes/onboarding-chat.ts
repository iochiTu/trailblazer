import { usageEvents, withTenant } from "@traiblazer/db";
import {
  availablePacks,
  type IndustryMatch,
  type IndustryPack,
  isSelectable,
  matchIndustry,
} from "@traiblazer/industry-packs";
import type { LLMGateway } from "@traiblazer/llm";
import { onboardingIndustrySchema } from "@traiblazer/shared";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { requireTenantRole } from "../plugins/auth.js";

type TenantParams = { Params: { tenantId: string } };

/** Descriptions one person can have read in a minute (each may be a model call). */
const PER_MINUTE = 20;

/** The prompt that sorts a description into one of the industries a business can choose. */
export function industryPrompt(available: IndustryPack[]): string {
  const list = available
    .map(
      (p) =>
        `- ${p.slug}: ${p.name}${p.variants.length ? ` (types: ${p.variants.map((v) => `${v.slug} = ${v.name}`).join("; ")})` : ""}`,
    )
    .join("\n");
  return [
    "You sort a business into one industry from how its owner describes it (in any language).",
    `Industries:\n${list}`,
    'Reply with JSON only, no other text: {"pack": "<industry slug>" or null, "variant": "<type slug>" or null}.',
    "Use null for pack when the description fits none of them well, or isn't about a business. Use null for variant unless one type clearly fits.",
  ].join("\n\n");
}

/** The model's reply as an industry a business can choose, or null. */
export function parseIndustry(text: string, phase: number): IndustryMatch | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const value = JSON.parse(json) as { pack?: unknown; variant?: unknown };
    if (typeof value.pack !== "string" || !isSelectable(value.pack, null, phase)) return null;
    const variant =
      typeof value.variant === "string" && isSelectable(value.pack, value.variant, phase)
        ? value.variant
        : null;
    return { pack: value.pack, variant };
  } catch {
    return null;
  }
}

async function askModel(gateway: LLMGateway, description: string, available: IndustryPack[], phase: number) {
  const result = await gateway.complete("aux", {
    system: [{ text: industryPrompt(available) }],
    messages: [{ role: "user", content: description }],
    maxTokens: 200,
    effort: "low",
  });
  return { match: parseIndustry(result.text, phase), meta: result };
}

/**
 * The onboarding chat (first sign-up): the owner answers in a chat, and the answers go through the
 * same routes as the rest of the portal (create the business and its assistant, save the interview,
 * add the website). This route is the one thing the chat needs on top:
 *   POST /v1/tenants/:t/onboarding/industry   the industry the owner's description points to
 * Words are matched first; the model is only asked when they find nothing or can't decide. The
 * description isn't stored.
 */
export async function onboardingChatRoutes(app: FastifyInstance, { db, gateway, platform }: AppContext) {
  app.post<TenantParams>(
    "/v1/tenants/:tenantId/onboarding/industry",
    {
      preHandler: requireTenantRole(db, "editor"),
      config: { rateLimit: { max: PER_MINUTE, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { description } = onboardingIndustrySchema.parse(request.body);
      const phase = (await platform!.policies()).releasedPackPhase;
      const available = availablePacks(phase);

      const byWords = matchIndustry(description, available);
      if (byWords) return { ...byWords, from: "words" as const };

      try {
        const { match, meta } = await askModel(gateway, description, available, phase);
        const tenantId = request.tenant!.id;
        await withTenant(db, tenantId, (tx) =>
          tx.insert(usageEvents).values({
            tenantId,
            kind: "llm.aux",
            quantity: meta.usage.inputTokens + meta.usage.outputTokens,
            costMicros: meta.costMicros,
            metadata: { task: "onboarding_industry", provider: meta.provider, model: meta.model },
          }),
        );
        return match
          ? { ...match, from: "model" as const }
          : { pack: null, variant: null, from: "none" as const };
      } catch (error) {
        // The owner picks from the list instead.
        request.log.warn({ err: error }, "onboarding industry: model unavailable");
        return { pack: null, variant: null, from: "none" as const };
      }
    },
  );
}
