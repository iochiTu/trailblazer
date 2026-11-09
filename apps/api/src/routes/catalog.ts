import { languages } from "@traiblazer/i18n";
import { availablePacks, packs } from "@traiblazer/industry-packs";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

/** Read-only reference data for the admin portal (industry packs, languages, plans). */
export async function catalogRoutes(app: FastifyInstance, { platform }: AppContext) {
  app.get("/v1/catalog/packs", async () => {
    // Which rollout phase is released is an operator policy.
    const available = availablePacks((await platform!.policies()).releasedPackPhase);
    return {
      available,
      upcoming: packs
        .filter((p) => !available.includes(p))
        .map(({ slug, name, sector, phase }) => ({ slug, name, sector, phase })),
    };
  });

  app.get("/v1/catalog/languages", async () => ({ languages }));

  // Public plan list for the portal page: active plans only, display fields only.
  app.get("/v1/catalog/plans", async () => {
    const [rows, policies] = await Promise.all([platform!.plans(), platform!.policies()]);
    return {
      defaultPlan: policies.defaultPlan,
      maxBusinessesPerAccount: policies.maxBusinessesPerAccount,
      plans: rows
        .filter((p) => p.active)
        .map((p) => ({
          id: p.id,
          nameEn: p.nameEn,
          nameFr: p.nameFr,
          monthlyQuestions: p.monthlyQuestions,
          perMinute: p.perMinute,
          concurrent: p.concurrent,
          knowledgeImages: p.knowledgeImages,
          priceMonthlyCents: p.priceMonthlyCents,
        })),
    };
  });
}
