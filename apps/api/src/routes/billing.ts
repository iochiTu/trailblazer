import { agencies, billingAccounts, billingEvents, plans, tenants } from "@traiblazer/db";
import { enOrFr } from "@traiblazer/i18n";
import { billingPlanSchema } from "@traiblazer/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { startCheckout } from "../billing/checkout.js";
import type { BillingPlan, BillingProvider } from "../billing/provider.js";
import { applySubscription, isPaying } from "../billing/sync.js";
import type { AppContext } from "../context.js";
import { HttpError, notFound } from "../lib/errors.js";
import type { PlanRow } from "../lib/platform.js";
import { requireTenantRole } from "../plugins/auth.js";

type TenantParams = { Params: { tenantId: string } };

/** An agency-pays client's plan is paid by its agency (docs/AGENCY.md §3.5), never by the client. */
const managedByAgency = () =>
  new HttpError(403, "managed_by_agency", "Your agency manages and pays for this business's plan.");

const unavailable = () =>
  new HttpError(
    503,
    "billing_unavailable",
    "Online payment isn't set up yet. Contact us to change your plan.",
  );

/** A plan can be bought when it is offered and has a monthly price. */
const purchasable = (p: PlanRow) => p.active && (p.priceMonthlyCents ?? 0) > 0;

const toBillingPlan = (p: PlanRow): BillingPlan => ({
  id: p.id,
  nameEn: p.nameEn,
  nameFr: p.nameFr,
  priceMonthlyCents: p.priceMonthlyCents ?? 0,
  productId: p.stripeProductId,
});

/**
 * Subscriptions (PLAN §14, Phase 2): the owner picks a plan and pays on the provider's checkout
 * page; the provider's webhook then puts the business on that plan.
 *
 *   GET  /v1/tenants/:t/billing            plan, subscription, plans that can be bought (admin+)
 *   POST /v1/tenants/:t/billing/checkout   { plan } → { url } of the checkout page (owner)
 *   POST /v1/tenants/:t/billing/portal     → { url } of the card, invoices and cancel page (owner)
 *   POST /v1/tenants/:t/billing/plan       { plan } switches a paying subscription, prorated (owner)
 *   POST /v1/billing/:provider/webhook     signed events from the provider
 *
 * Only the business's owner pays: staff helping a business (support access) can see the page but
 * not buy or change anything, and demo businesses can't be bought for.
 */
export async function billingRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, config } = ctx;
  const platform = ctx.platform!;
  const billing = ctx.billing ?? null;
  const portalUrl = (tenantId: string) => `${config.ADMIN_ORIGIN.replace(/\/$/, "")}/t/${tenantId}/billing`;

  const loadTenant = async (tenantId: string) => {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw notFound("Business");
    const [account] = await db
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.tenantId, tenantId))
      .limit(1);
    return { tenant, account: account ?? null };
  };

  /** The owner of a real business, signed in as themselves, on a platform with billing set up. */
  const payer = (request: FastifyRequest) => {
    if (request.tenant!.support)
      throw new HttpError(403, "support_access", "Only the business's owner can change the subscription.");
    if (request.user!.demo)
      throw new HttpError(403, "demo_account", "A demo account can't buy a plan. Sign up to get started.");
    if (!billing) throw unavailable();
    return billing;
  };

  const planToBuy = async (id: string) => {
    const plan = (await platform.plans()).find((p) => p.id === id);
    if (!plan || !purchasable(plan))
      throw new HttpError(400, "plan_not_available", "This plan can't be bought online.");
    return plan;
  };

  /** The plan's product at the provider, created the first time someone buys it. */
  const productFor = async (provider: BillingProvider, plan: PlanRow) => {
    if (plan.stripeProductId) return plan.stripeProductId;
    const id = await provider.createProduct(toBillingPlan(plan));
    await db.update(plans).set({ stripeProductId: id }).where(eq(plans.id, plan.id));
    platform.invalidate();
    return id;
  };

  app.get<TenantParams>(
    "/v1/tenants/:tenantId/billing",
    { preHandler: requireTenantRole(db, "admin") },
    async (request) => {
      const { tenant, account } = await loadTenant(request.tenant!.id);
      const allPlans = await platform.plans();
      const [agency] = tenant.agencyId
        ? await db
            .select({ name: agencies.name })
            .from(agencies)
            .where(eq(agencies.id, tenant.agencyId))
            .limit(1)
        : [];
      return {
        enabled: !!billing,
        /** Set when the business's agency pays for its plan: the page shows who to talk to. */
        managedBy: tenant.agencyBillingMode === "agency_pays" ? (agency?.name ?? null) : null,
        plan: tenant.plan,
        planName: (await platform.plan(tenant.plan)).name,
        demo: tenant.kind === "demo" || !!request.user!.demo,
        canManage: request.tenant!.role === "owner" && !request.tenant!.support,
        setupFeePaid: !!account?.setupFeePaidAt,
        subscription:
          account?.stripeSubscriptionId && account.status
            ? {
                status: account.status,
                plan: account.plan,
                priceMonthlyCents: account.priceMonthlyCents,
                currentPeriodEnd: account.currentPeriodEnd,
                cancelAt: account.cancelAt,
              }
            : null,
        hasCustomer: !!account,
        plans: allPlans.filter(purchasable).map((p) => ({
          id: p.id,
          nameEn: p.nameEn,
          nameFr: p.nameFr,
          priceMonthlyCents: p.priceMonthlyCents,
          setupFeeCents: p.setupFeeCents,
          monthlyQuestions: p.monthlyQuestions,
          knowledgeImages: p.knowledgeImages,
          insights: p.insights,
        })),
      };
    },
  );

  app.post<TenantParams>(
    "/v1/tenants/:tenantId/billing/checkout",
    { preHandler: requireTenantRole(db, "owner") },
    async (request) => {
      const { tenant, account } = await loadTenant(request.tenant!.id);
      if (tenant.agencyBillingMode === "agency_pays") throw managedByAgency();
      const provider = payer(request);
      const { plan: planId } = billingPlanSchema.parse(request.body);
      if (tenant.kind === "demo")
        throw new HttpError(403, "demo_business", "A demo business can't be bought for.");
      if (isPaying(account?.status))
        throw new HttpError(
          409,
          "already_subscribed",
          "This business already pays for a plan. Change plans instead.",
        );
      const plan = await planToBuy(planId);

      let customerId = account?.stripeCustomerId;
      if (!customerId) {
        customerId = await provider.createCustomer({
          tenantId: tenant.id,
          name: tenant.name,
          email: request.user!.email,
        });
        // The idempotent customer call returns the same id to a second click at the same time.
        await db
          .insert(billingAccounts)
          .values({ tenantId: tenant.id, stripeCustomerId: customerId })
          .onConflictDoNothing();
      }
      const url = await startCheckout(db, provider, {
        tenantId: tenant.id,
        productId: await productFor(provider, plan),
        plan: toBillingPlan(plan),
        setupFeeCents: plan.setupFeeCents ?? 0,
        language: enOrFr(request.user!.uiLanguage),
        returnUrl: portalUrl(tenant.id),
      });
      return { url };
    },
  );

  app.post<TenantParams>(
    "/v1/tenants/:tenantId/billing/portal",
    { preHandler: requireTenantRole(db, "owner") },
    async (request) => {
      const provider = payer(request);
      const { tenant, account } = await loadTenant(request.tenant!.id);
      if (!account) throw new HttpError(409, "no_subscription", "This business hasn't paid for a plan yet.");
      const url = await provider.createPortal({
        customerId: account.stripeCustomerId,
        returnUrl: portalUrl(tenant.id),
        language: enOrFr(request.user!.uiLanguage),
      });
      return { url };
    },
  );

  app.post<TenantParams>(
    "/v1/tenants/:tenantId/billing/plan",
    { preHandler: requireTenantRole(db, "owner") },
    async (request) => {
      const { tenant, account } = await loadTenant(request.tenant!.id);
      if (tenant.agencyBillingMode === "agency_pays") throw managedByAgency();
      const provider = payer(request);
      const { plan: planId } = billingPlanSchema.parse(request.body);
      if (!account?.stripeSubscriptionId || !isPaying(account.status))
        throw new HttpError(409, "no_subscription", "This business doesn't pay for a plan yet.");
      if (account.plan === planId) return { plan: planId };
      const plan = await planToBuy(planId);
      const updated = await provider.changePlan({
        subscriptionId: account.stripeSubscriptionId,
        productId: await productFor(provider, plan),
        plan: toBillingPlan(plan),
      });
      // Applied now rather than when the webhook arrives, so the owner sees the new plan at once.
      await applySubscription(db, platform, updated);
      return { plan: planId };
    },
  );

  if (!billing) return;

  // The signature is computed over the exact bytes, so this route reads its body unparsed.
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: 512 * 1024 },
      (_req, body, done) => done(null, body),
    );
    // The provider sends from few addresses: the per-address limit is for people.
    const options = { config: { rateLimit: { max: 3000, timeWindow: "1 minute" } } };

    scope.post(`/v1/billing/${billing.id}/webhook`, options, async (request, reply) => {
      const header = request.headers[billing.signatureHeader];
      const event = Buffer.isBuffer(request.body)
        ? billing.parseWebhook(request.body, Array.isArray(header) ? header[0] : header)
        : null;
      if (!event) return reply.code(400).send({ error: "bad_signature", message: "Bad signature" });

      const [seen] = await db
        .select({ id: billingEvents.id })
        .from(billingEvents)
        .where(eq(billingEvents.id, event.id))
        .limit(1);
      if (seen) return { received: true, duplicate: true };

      if (event.checkout?.tenantId && event.checkout.setupFee && event.checkout.paid && event.customerId) {
        await db
          .update(billingAccounts)
          .set({ setupFeePaidAt: new Date() })
          .where(eq(billingAccounts.stripeCustomerId, event.customerId));
      }
      if (event.subscriptionId) {
        // Read the subscription as it is now: events can arrive late or out of order.
        const sub = await billing.getSubscription(event.subscriptionId);
        if (sub) {
          const result = await applySubscription(db, platform, sub);
          if (result !== "applied")
            request.log.warn({ event: event.id, result }, "billing event not applied");
        }
      }
      // Recorded once handled, so an event that failed half-way is handled again on the retry.
      await db.insert(billingEvents).values({ id: event.id, type: event.type }).onConflictDoNothing();
      return { received: true };
    });
  });
}
