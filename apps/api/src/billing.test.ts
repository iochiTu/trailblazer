import {
  auditLogs,
  billingAccounts,
  billingEvents,
  createDb,
  type DbHandle,
  memberships,
  plans,
  runMigrations,
  tenants,
  users,
} from "@traiblazer/db";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { eq, inArray, like } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { StripeBilling } from "./billing/stripe.js";
import { loadConfig } from "./config.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;
const WEBHOOK_SECRET = "whsec_test_secret";
const ADMIN = "http://admin.test.local";

/**
 * Stands in for Stripe's servers: records what we ask for and keeps subscriptions in memory.
 * Webhook signatures are made and checked by the real Stripe library.
 */
class FakeStripe {
  readonly real = new Stripe("sk_test_fake");
  readonly calls: { method: string; params: Record<string, unknown> }[] = [];
  readonly subscriptions = new Map<string, Stripe.Subscription>();
  private n = 0;
  private next = (prefix: string) => `${prefix}_${++this.n}_${crypto.randomUUID().slice(0, 6)}`;
  private record = (method: string, params: object) =>
    this.calls.push({ method, params: params as Record<string, unknown> });

  customers = {
    create: async (params: Stripe.CustomerCreateParams) => {
      this.record("customers.create", params);
      return { id: this.next("cus") };
    },
  };
  products = {
    create: async (params: Stripe.ProductCreateParams) => {
      this.record("products.create", params);
      return { id: this.next("prod") };
    },
  };
  readonly sessions = new Map<
    string,
    {
      id: string;
      mode: string;
      customer: string;
      url: string;
      status: string;
      subscription: string | null;
      metadata: Stripe.MetadataParam | undefined;
    }
  >();
  readonly checkoutKeys = new Map<string, string>();
  loseResponse = false;
  checkout = {
    sessions: {
      create: async (params: Stripe.Checkout.SessionCreateParams, options: Stripe.RequestOptions) => {
        const key = options.idempotencyKey!;
        const prior = this.checkoutKeys.get(key);
        if (prior) return this.sessions.get(prior)!;
        this.record("checkout.sessions.create", params);
        const id = this.next("cs");
        const session = {
          id,
          customer: params.customer!,
          mode: "subscription",
          url: "https://checkout.stripe.test/pay",
          status: "open",
          subscription: null,
          metadata: params.metadata,
        };
        this.sessions.set(id, session);
        this.checkoutKeys.set(key, id);
        if (this.loseResponse) {
          this.loseResponse = false;
          throw new Error("Lost response");
        }
        return session;
      },
      retrieve: async (id: string) => this.sessions.get(id)!,
      expire: async (id: string) => {
        const s = this.sessions.get(id)!;
        if (s.status !== "open") throw new Error("Already completed");
        s.status = "expired";
        return s;
      },
      list: ({ customer }: { customer: string }) =>
        Array.from(this.sessions.values()).filter((s) => s.customer === customer),
    },
  };
  billingPortal = {
    sessions: {
      create: async (params: Stripe.BillingPortal.SessionCreateParams) => {
        this.record("billingPortal.sessions.create", params);
        return { url: "https://billing.stripe.test/portal" };
      },
    },
  };
  subscriptionsApi = {
    retrieve: async (id: string) => {
      const sub = this.subscriptions.get(id);
      if (!sub)
        throw new Stripe.errors.StripeInvalidRequestError({
          message: "No such subscription",
          statusCode: 404,
        } as never);
      return sub;
    },
    update: async (id: string, params: Stripe.SubscriptionUpdateParams) => {
      this.record("subscriptions.update", params);
      const sub = this.subscriptions.get(id)!;
      const item = params.items![0]!;
      const updated = this.makeSubscription({
        id,
        customer: sub.customer as string,
        metadata: params.metadata as Record<string, string>,
        unitAmount: item.price_data!.unit_amount!,
      });
      this.subscriptions.set(id, updated);
      return updated;
    },
  };
  get webhooks() {
    return this.real.webhooks;
  }

  makeSubscription(input: {
    id?: string;
    customer: string;
    metadata: Record<string, string>;
    unitAmount: number;
    status?: Stripe.Subscription.Status;
    cancelAtPeriodEnd?: boolean;
  }): Stripe.Subscription {
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
    return {
      id: input.id ?? this.next("sub"),
      object: "subscription",
      customer: input.customer,
      status: input.status ?? "active",
      metadata: input.metadata,
      cancel_at: null,
      cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
      items: {
        object: "list",
        data: [{ id: "si_1", current_period_end: periodEnd, price: { unit_amount: input.unitAmount } }],
      },
    } as unknown as Stripe.Subscription;
  }

  /** Adds a subscription as Stripe would after a paid checkout. */
  subscribe(
    customer: string,
    tenantId: string,
    plan: string,
    unitAmount: number,
    status: Stripe.Subscription.Status = "active",
  ) {
    const sub = this.makeSubscription({
      customer,
      metadata: { tenant_id: tenantId, plan },
      unitAmount,
      status,
    });
    this.subscriptions.set(sub.id, sub);
    return sub;
  }

  /** A signed webhook request, as Stripe sends it. */
  event(type: string, object: object, id = this.next("evt")) {
    const payload = JSON.stringify({ id, object: "event", type, data: { object } });
    const signature = this.real.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    return { payload, signature, id };
  }
}

let fake: FakeStripe;
let appDb: DbHandle;
let ownerDb: DbHandle;
let app: FastifyInstance;
let bare: FastifyInstance;
const emails: string[] = [];
const tenantIds: string[] = [];
let savedPlans: (typeof plans.$inferSelect)[] = [];

async function signup(prefix: string, target = app) {
  const email = `${prefix}-${crypto.randomUUID().slice(0, 8)}@test.local`;
  emails.push(email);
  const res = await target.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email, password: "correct-horse-battery", name: prefix },
  });
  return {
    id: res.json().user.id as string,
    email,
    cookie: `tb_session=${res.cookies.find((c) => c.name === "tb_session")!.value}`,
  };
}

async function newBusiness(target = app) {
  const owner = await signup("owner", target);
  const res = await target.inject({
    method: "POST",
    url: "/v1/tenants",
    headers: { cookie: owner.cookie },
    payload: { name: "Lakehead Plumbing" },
  });
  const tenantId = res.json().tenant.id as string;
  tenantIds.push(tenantId);
  return { owner, tenantId };
}

const call = (
  method: "GET" | "POST" | "PATCH",
  url: string,
  cookie: string,
  payload?: object,
  target = app,
) => target.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const deliver = (event: { payload: string; signature: string }) =>
  app.inject({
    method: "POST",
    url: "/v1/billing/stripe/webhook",
    headers: { "content-type": "application/json", "stripe-signature": event.signature },
    payload: event.payload,
  });

const tenantPlan = async (id: string) =>
  (await ownerDb.db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, id)))[0]!.plan;
const account = async (id: string) =>
  (await ownerDb.db.select().from(billingAccounts).where(eq(billingAccounts.tenantId, id)))[0];

/** Starts a checkout for the plan and completes it the way Stripe reports it. */
async function pay(tenantId: string, cookie: string, plan = "local", setupFee = true) {
  const res = await call("POST", `/v1/tenants/${tenantId}/billing/checkout`, cookie, { plan });
  expect(res.statusCode, res.body).toBe(200);
  const customer = (await account(tenantId))!.stripeCustomerId;
  const amount = plan === "local" ? 4900 : 9900;
  const sub = fake.subscribe(customer, tenantId, plan, amount);
  const session = Array.from(fake.sessions.values()).find(
    (s) => s.customer === customer && s.status === "open",
  )!;
  session.status = "complete";
  session.subscription = sub.id;
  const event = fake.event("checkout.session.completed", {
    object: "checkout.session",
    customer,
    subscription: sub.id,
    client_reference_id: tenantId,
    payment_status: "paid",
    metadata: { tenant_id: tenantId, plan, setup_fee: setupFee ? "1" : "0" },
  });
  expect((await deliver(event)).statusCode).toBe(200);
  return { sub, customer };
}

beforeAll(async () => {
  await runMigrations(ownerUrl);
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  savedPlans = await ownerDb.db
    .select()
    .from(plans)
    .where(inArray(plans.id, ["local", "local_plus", "trial"]));
  await ownerDb.db
    .update(plans)
    .set({ priceMonthlyCents: 4900, setupFeeCents: 19900, stripeProductId: null, active: true })
    .where(eq(plans.id, "local"));
  await ownerDb.db
    .update(plans)
    .set({ priceMonthlyCents: 9900, setupFeeCents: 19900, stripeProductId: null, active: true })
    .where(eq(plans.id, "local_plus"));
  await ownerDb.db.update(plans).set({ priceMonthlyCents: null }).where(eq(plans.id, "trial"));

  const config = loadConfig({
    NODE_ENV: "test",
    AUTH_RATE_LIMIT_PER_MIN: "1000",
    ADMIN_ORIGIN: ADMIN,
    PLATFORM_CACHE_SECONDS: "0",
  } as NodeJS.ProcessEnv);
  const gateway = createGatewayFromEnv({}).gateway;
  fake = new FakeStripe();
  // The fake's methods are arrow functions bound to it, so they can be handed over as they are.
  const client = {
    ...fake,
    subscriptions: fake.subscriptionsApi,
    webhooks: fake.real.webhooks,
  } as unknown as Stripe;
  const billing = new StripeBilling({
    secretKey: "sk_test_fake",
    webhookSecret: WEBHOOK_SECRET,
    automaticTax: true,
    client,
  });
  app = await buildApp({ db: appDb.db, config, gateway, billing });
  bare = await buildApp({ db: appDb.db, config, gateway });
});

beforeEach(() => {
  fake.calls.length = 0;
});

afterAll(async () => {
  if (ownerDb) {
    if (tenantIds.length) await ownerDb.db.delete(tenants).where(inArray(tenants.id, tenantIds));
    if (emails.length) await ownerDb.db.delete(users).where(inArray(users.email, emails));
    await ownerDb.db.delete(billingEvents).where(like(billingEvents.id, "evt_%"));
    for (const p of savedPlans) {
      const { id, createdAt: _c, updatedAt: _u, ...rest } = p;
      await ownerDb.db.update(plans).set(rest).where(eq(plans.id, id));
    }
  }
  await app?.close();
  await bare?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("billing: without a payment provider", () => {
  it("shows the plans but can't take payment", async () => {
    const { owner, tenantId } = await newBusiness(bare);
    const res = await call("GET", `/v1/tenants/${tenantId}/billing`, owner.cookie, undefined, bare);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(false);
    expect(body.canManage).toBe(true);
    // Only plans with a price can be bought: the free trial isn't listed.
    expect(body.plans.map((p: { id: string }) => p.id)).toEqual(
      expect.arrayContaining(["local", "local_plus"]),
    );
    expect(body.plans.find((p: { id: string }) => p.id === "trial")).toBeUndefined();
    const checkout = await call(
      "POST",
      `/v1/tenants/${tenantId}/billing/checkout`,
      owner.cookie,
      { plan: "local" },
      bare,
    );
    expect(checkout.statusCode).toBe(503);
    expect(checkout.json().error).toBe("billing_unavailable");
    // No webhook route without a provider.
    expect(
      (await bare.inject({ method: "POST", url: "/v1/billing/stripe/webhook", payload: {} })).statusCode,
    ).toBe(404);
  });
});

describe("billing: checkout", () => {
  it("opens Stripe checkout in CAD with the setup fee, taxes and the business in the metadata", async () => {
    const { owner, tenantId } = await newBusiness();
    const res = await call("POST", `/v1/tenants/${tenantId}/billing/checkout`, owner.cookie, {
      plan: "local",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().url).toBe("https://checkout.stripe.test/pay");

    const customer = fake.calls.find((c) => c.method === "customers.create")!.params;
    expect(customer).toMatchObject({
      name: "Lakehead Plumbing",
      email: owner.email,
      metadata: { tenant_id: tenantId },
    });
    const session = fake.calls.find((c) => c.method === "checkout.sessions.create")!
      .params as unknown as Stripe.Checkout.SessionCreateParams;
    expect(session.mode).toBe("subscription");
    expect(session.automatic_tax).toEqual({ enabled: true });
    expect(session.subscription_data?.metadata).toEqual({ tenant_id: tenantId, plan: "local" });
    expect(session.success_url).toBe(`${ADMIN}/t/${tenantId}/billing?checkout=done`);
    const [monthly, setup] = session.line_items!;
    expect(monthly!.price_data).toMatchObject({
      currency: "cad",
      unit_amount: 4900,
      recurring: { interval: "month" },
    });
    expect(setup!.price_data).toMatchObject({ currency: "cad", unit_amount: 19900 });
    expect(setup!.price_data!.recurring).toBeUndefined();

    // The plan's product is created once and remembered.
    const [plan] = await ownerDb.db.select().from(plans).where(eq(plans.id, "local"));
    expect(plan!.stripeProductId).toMatch(/^prod_/);
    fake.calls.length = 0;
    await call("POST", `/v1/tenants/${tenantId}/billing/checkout`, owner.cookie, { plan: "local" });
    expect(
      fake.calls.filter((c) => c.method === "products.create" || c.method === "customers.create"),
    ).toHaveLength(0);
  });

  it("recovers a lost checkout response, reuses the same attempt and retires it before switching plans", async () => {
    const { owner, tenantId } = await newBusiness();
    const checkout = (plan = "local") =>
      call("POST", `/v1/tenants/${tenantId}/billing/checkout`, owner.cookie, { plan });
    fake.loseResponse = true;
    expect((await checkout()).statusCode).toBe(500);
    const responses = await Promise.all([checkout(), checkout()]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    const customer = (await account(tenantId))!.stripeCustomerId;
    const sessions = () => fake.checkout.sessions.list({ customer });
    expect(sessions()).toHaveLength(1);
    const first = sessions()[0]!;
    expect((await checkout("local_plus")).statusCode).toBe(200);
    expect(first.status).toBe("expired");
    const open = sessions().filter((s) => s.status === "open");
    expect(open).toHaveLength(1);
    open[0]!.status = "complete";
    expect((await checkout()).statusCode).toBe(409);
    expect(sessions()).toHaveLength(2);
  });

  it("retires a checkout issued before the migration and replaces an expired session", async () => {
    const { owner, tenantId } = await newBusiness();
    const checkout = () =>
      call("POST", `/v1/tenants/${tenantId}/billing/checkout`, owner.cookie, { plan: "local" });
    const customer = `cus_${crypto.randomUUID()}`;
    await ownerDb.db.insert(billingAccounts).values({ tenantId, stripeCustomerId: customer });
    const legacy = {
      id: `cs_${crypto.randomUUID()}`,
      mode: "subscription",
      customer,
      url: "https://checkout.stripe.test/old",
      status: "open",
      subscription: null,
      metadata: {},
    };
    fake.sessions.set(legacy.id, legacy);
    expect((await checkout()).statusCode).toBe(200);
    expect(legacy.status).toBe("expired");
    const previous = (await account(tenantId))!.checkoutAttempt!;
    fake.sessions.get(previous.sessionId!)!.status = "expired";
    expect((await checkout()).statusCode).toBe(200);
    const next = (await account(tenantId))!.checkoutAttempt!;
    expect(next.id).not.toBe(previous.id);
    expect(fake.checkout.sessions.list({ customer }).filter((s) => s.status === "open")).toHaveLength(1);
  });

  it("refuses plans that can't be bought, staff, other roles and demo businesses", async () => {
    const { owner, tenantId } = await newBusiness();
    const checkout = (cookie: string, plan = "local") =>
      call("POST", `/v1/tenants/${tenantId}/billing/checkout`, cookie, { plan });
    expect((await checkout(owner.cookie, "trial")).json().error).toBe("plan_not_available");
    expect((await checkout(owner.cookie, "no_such_plan")).statusCode).toBe(400);

    // An admin of the business sees the page but can't pay.
    const admin = await signup("admin");
    await ownerDb.db.insert(memberships).values({ tenantId, userId: admin.id, role: "admin" });
    expect((await call("GET", `/v1/tenants/${tenantId}/billing`, admin.cookie)).json().canManage).toBe(false);
    expect((await checkout(admin.cookie)).statusCode).toBe(403);

    // Staff on support access: same.
    const staff = await signup("staff");
    await ownerDb.db.update(users).set({ platformRole: "super_admin" }).where(eq(users.id, staff.id));
    expect((await checkout(staff.cookie)).statusCode).toBe(403);

    await ownerDb.db.update(tenants).set({ kind: "demo" }).where(eq(tenants.id, tenantId));
    const demo = await checkout(owner.cookie);
    expect(demo.statusCode).toBe(403);
    expect(demo.json().error).toBe("demo_business");
    expect((await call("GET", `/v1/tenants/${tenantId}/billing`, owner.cookie)).json().demo).toBe(true);
  });
});

describe("billing: webhook", () => {
  it("refuses unsigned or wrongly signed events", async () => {
    const event = fake.event("customer.subscription.updated", { id: "sub_x", customer: "cus_x" });
    expect((await deliver({ payload: event.payload, signature: "t=1,v1=bad" })).statusCode).toBe(400);
    const tampered = { payload: event.payload.replace("sub_x", "sub_y"), signature: event.signature };
    expect((await deliver(tampered)).statusCode).toBe(400);
  });

  it("puts the business on the plan it paid for, once, and records it", async () => {
    const { owner, tenantId } = await newBusiness();
    expect(await tenantPlan(tenantId)).toBe("trial");
    const { sub } = await pay(tenantId, owner.cookie);

    expect(await tenantPlan(tenantId)).toBe("local");
    const row = (await account(tenantId))!;
    expect(row).toMatchObject({
      stripeSubscriptionId: sub.id,
      status: "active",
      plan: "local",
      priceMonthlyCents: 4900,
    });
    expect(row.setupFeePaidAt).toBeInstanceOf(Date);
    expect(row.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());

    const logs = await ownerDb.db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    expect(logs.find((l) => l.action === "billing.subscription")?.metadata).toMatchObject({
      status: "active",
      plan: "local",
      previousPlan: "trial",
    });

    const page = (await call("GET", `/v1/tenants/${tenantId}/billing`, owner.cookie)).json();
    expect(page.plan).toBe("local");
    expect(page.setupFeePaid).toBe(true);
    expect(page.subscription).toMatchObject({ status: "active", plan: "local", priceMonthlyCents: 4900 });

    // Already paying: a second checkout is refused; the setup fee isn't charged again later.
    const again = await call("POST", `/v1/tenants/${tenantId}/billing/checkout`, owner.cookie, {
      plan: "local_plus",
    });
    expect(again.statusCode).toBe(409);
  });

  it("acknowledges a repeated event without handling it twice", async () => {
    const { owner, tenantId } = await newBusiness();
    const { sub, customer } = await pay(tenantId, owner.cookie);
    const event = fake.event("customer.subscription.updated", { id: sub.id, customer });
    expect((await deliver(event)).json()).toEqual({ received: true });
    expect((await deliver(event)).json()).toEqual({ received: true, duplicate: true });
  });

  it("ignores customers that aren't ours", async () => {
    const sub = fake.subscribe("cus_someone_else", crypto.randomUUID(), "local", 4900);
    const res = await deliver(
      fake.event("customer.subscription.created", { id: sub.id, customer: "cus_someone_else" }),
    );
    expect(res.statusCode).toBe(200);
  });

  it("keeps the plan while a payment is retried, and returns to the free plan when it ends", async () => {
    const { owner, tenantId } = await newBusiness();
    const { sub, customer } = await pay(tenantId, owner.cookie);

    fake.subscriptions.set(
      sub.id,
      fake.makeSubscription({
        id: sub.id,
        customer,
        metadata: sub.metadata,
        unitAmount: 4900,
        status: "past_due",
      }),
    );
    await deliver(
      fake.event("invoice.payment_failed", {
        customer,
        parent: { subscription_details: { subscription: sub.id } },
      }),
    );
    expect((await account(tenantId))!.status).toBe("past_due");
    expect(await tenantPlan(tenantId)).toBe("local");

    // Cancelled at the end of the period: still paid for until then.
    fake.subscriptions.set(
      sub.id,
      fake.makeSubscription({
        id: sub.id,
        customer,
        metadata: sub.metadata,
        unitAmount: 4900,
        cancelAtPeriodEnd: true,
      }),
    );
    await deliver(fake.event("customer.subscription.updated", { id: sub.id, customer }));
    expect((await account(tenantId))!.cancelAt).toBeInstanceOf(Date);
    expect(await tenantPlan(tenantId)).toBe("local");

    fake.subscriptions.set(
      sub.id,
      fake.makeSubscription({
        id: sub.id,
        customer,
        metadata: sub.metadata,
        unitAmount: 4900,
        status: "canceled",
      }),
    );
    await deliver(fake.event("customer.subscription.deleted", { id: sub.id, customer }));
    expect(await tenantPlan(tenantId)).toBe("trial");
    expect((await account(tenantId))!.status).toBe("canceled");

    // Starting again: a new checkout, without the setup fee this time.
    fake.calls.length = 0;
    await call("POST", `/v1/tenants/${tenantId}/billing/checkout`, owner.cookie, { plan: "local" });
    const session = fake.calls.find((c) => c.method === "checkout.sessions.create")!
      .params as unknown as Stripe.Checkout.SessionCreateParams;
    expect(session.line_items).toHaveLength(1);
  });

  it("doesn't let an old subscription ending undo the one that pays now", async () => {
    const { owner, tenantId } = await newBusiness();
    const { sub: first, customer } = await pay(tenantId, owner.cookie);
    const second = fake.subscribe(customer, tenantId, "local_plus", 9900);
    await deliver(fake.event("customer.subscription.created", { id: second.id, customer }));
    expect(await tenantPlan(tenantId)).toBe("local_plus");

    fake.subscriptions.set(
      first.id,
      fake.makeSubscription({
        id: first.id,
        customer,
        metadata: first.metadata,
        unitAmount: 4900,
        status: "canceled",
      }),
    );
    await deliver(fake.event("customer.subscription.deleted", { id: first.id, customer }));
    expect(await tenantPlan(tenantId)).toBe("local_plus");
    expect((await account(tenantId))!.stripeSubscriptionId).toBe(second.id);
  });
});

describe("billing: changing plans and managing", () => {
  it("switches a paying business at once, prorated, at the new plan's price", async () => {
    const { owner, tenantId } = await newBusiness();
    const { sub } = await pay(tenantId, owner.cookie);
    const res = await call("POST", `/v1/tenants/${tenantId}/billing/plan`, owner.cookie, {
      plan: "local_plus",
    });
    expect(res.statusCode, res.body).toBe(200);
    const update = fake.calls.find((c) => c.method === "subscriptions.update")!
      .params as unknown as Stripe.SubscriptionUpdateParams;
    expect(update.proration_behavior).toBe("create_prorations");
    expect(update.items![0]).toMatchObject({
      id: "si_1",
      price_data: { unit_amount: 9900, currency: "cad" },
    });
    expect(update.metadata).toMatchObject({ plan: "local_plus", tenant_id: tenantId });
    expect(await tenantPlan(tenantId)).toBe("local_plus");
    expect((await account(tenantId))!).toMatchObject({
      stripeSubscriptionId: sub.id,
      priceMonthlyCents: 9900,
    });
  });

  it("needs a subscription to switch or to open the portal", async () => {
    const { owner, tenantId } = await newBusiness();
    expect(
      (await call("POST", `/v1/tenants/${tenantId}/billing/plan`, owner.cookie, { plan: "local_plus" }))
        .statusCode,
    ).toBe(409);
    expect((await call("POST", `/v1/tenants/${tenantId}/billing/portal`, owner.cookie)).statusCode).toBe(409);
    await pay(tenantId, owner.cookie);
    const portal = await call("POST", `/v1/tenants/${tenantId}/billing/portal`, owner.cookie);
    expect(portal.json().url).toBe("https://billing.stripe.test/portal");
    expect(fake.calls.find((c) => c.method === "billingPortal.sessions.create")!.params).toMatchObject({
      return_url: `${ADMIN}/t/${tenantId}/billing`,
      locale: "en",
    });
  });

  it("stops operators from changing a paying business's plan by hand", async () => {
    const { owner, tenantId } = await newBusiness();
    const staff = await signup("operator");
    await ownerDb.db.update(users).set({ platformRole: "super_admin" }).where(eq(users.id, staff.id));
    await pay(tenantId, owner.cookie);
    const res = await call("PATCH", `/v1/operator/tenants/${tenantId}`, staff.cookie, { plan: "business" });
    expect(res.statusCode).toBe(409);
    // Suspending still works.
    expect(
      (await call("PATCH", `/v1/operator/tenants/${tenantId}`, staff.cookie, { status: "suspended" }))
        .statusCode,
    ).toBe(200);
    const detail = (await call("GET", `/v1/operator/tenants/${tenantId}`, staff.cookie)).json();
    expect(detail.billing).toMatchObject({ status: "active", plan: "local", priceMonthlyCents: 4900 });
  });
});
