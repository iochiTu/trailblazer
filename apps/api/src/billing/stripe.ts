import Stripe from "stripe";
import type {
  BillingEvent,
  BillingPlan,
  BillingProvider,
  CheckoutInput,
  CheckoutSession,
  SubscriptionSnapshot,
} from "./provider.js";

const CURRENCY = "cad";

export interface StripeBillingOptions {
  secretKey: string;
  webhookSecret: string;
  /** Stripe Tax adds GST/HST/QST from the customer's address (must be set up in the Stripe dashboard). */
  automaticTax: boolean;
  /** Tests point the client at a fake server. */
  client?: Stripe;
}

const date = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000) : null);
const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);

function checkoutSnapshot(session: Stripe.Checkout.Session): CheckoutSession {
  for (const status of ["open", "expired", "complete"] as const) {
    if (session.status === status)
      return { id: session.id, url: session.url, status, subscriptionId: idOf(session.subscription) };
  }
  throw new Error("Checkout session has an unknown status");
}

export function snapshot(sub: Stripe.Subscription): SubscriptionSnapshot {
  const item = sub.items.data[0];
  return {
    id: sub.id,
    customerId: idOf(sub.customer)!,
    tenantId: sub.metadata?.tenant_id ?? null,
    planId: sub.metadata?.plan ?? null,
    status: sub.status,
    priceMonthlyCents: item?.price?.unit_amount ?? null,
    currentPeriodEnd: date(item?.current_period_end),
    cancelAt: sub.cancel_at_period_end ? date(item?.current_period_end) : date(sub.cancel_at),
  };
}

export class StripeBilling implements BillingProvider {
  readonly id = "stripe";
  readonly signatureHeader = "stripe-signature";
  private readonly stripe: Stripe;

  constructor(private readonly options: StripeBillingOptions) {
    this.stripe = options.client ?? new Stripe(options.secretKey, { maxNetworkRetries: 2 });
  }

  async createCustomer(input: { tenantId: string; name: string; email: string | null }) {
    const customer = await this.stripe.customers.create(
      {
        name: input.name,
        ...(input.email ? { email: input.email } : {}),
        metadata: { tenant_id: input.tenantId },
      },
      // Two clicks at once create one customer.
      { idempotencyKey: `customer:${input.tenantId}` },
    );
    return customer.id;
  }

  async createProduct(plan: BillingPlan) {
    const product = await this.stripe.products.create(
      { name: plan.nameEn, metadata: { plan: plan.id } },
      { idempotencyKey: `product:${plan.id}` },
    );
    return product.id;
  }

  async createCheckout(input: CheckoutInput) {
    const metadata = { tenant_id: input.tenantId, plan: input.plan.id };
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          product: input.productId,
          unit_amount: input.plan.priceMonthlyCents,
          recurring: { interval: "month" },
          ...(this.options.automaticTax ? { tax_behavior: "exclusive" as const } : {}),
        },
      },
    ];
    // A one-time price in a subscription checkout is charged once, on the first invoice.
    if (input.setupFeeCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          product_data: { name: input.language === "fr" ? "Frais de mise en place" : "Setup fee" },
          unit_amount: input.setupFeeCents,
          ...(this.options.automaticTax ? { tax_behavior: "exclusive" as const } : {}),
        },
      });
    }
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: "subscription",
        expires_at: input.expiresAt,
        customer: input.customerId,
        line_items: lineItems,
        locale: input.language,
        client_reference_id: input.tenantId,
        metadata: {
          ...metadata,
          attempt_id: input.attemptId,
          setup_fee: input.setupFeeCents > 0 ? "1" : "0",
        },
        subscription_data: { metadata },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        billing_address_collection: "required",
        tax_id_collection: { enabled: true },
        customer_update: { address: "auto", name: "auto" },
        ...(this.options.automaticTax ? { automatic_tax: { enabled: true } } : {}),
      },
      { idempotencyKey: `checkout:${input.attemptId}` },
    );
    return checkoutSnapshot(session);
  }

  async getCheckout(id: string) {
    return checkoutSnapshot(await this.stripe.checkout.sessions.retrieve(id));
  }

  async findCheckouts(customerId: string, attemptId: string | null) {
    const found: CheckoutSession[] = [];
    for await (const session of this.stripe.checkout.sessions.list({ customer: customerId, limit: 100 })) {
      if (
        session.mode === "subscription" &&
        (session.metadata?.attempt_id ?? null) === attemptId &&
        (attemptId !== null || session.status !== "expired")
      ) {
        found.push(checkoutSnapshot(session));
        if (attemptId !== null) break;
      }
    }
    return found;
  }

  async expireCheckout(id: string) {
    await this.stripe.checkout.sessions.expire(id);
  }

  async createPortal(input: { customerId: string; returnUrl: string; language: "en" | "fr" }) {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
      locale: input.language,
    });
    return session.url;
  }

  async changePlan(input: { subscriptionId: string; productId: string; plan: BillingPlan }) {
    const current = await this.stripe.subscriptions.retrieve(input.subscriptionId);
    const item = current.items.data[0];
    const updated = await this.stripe.subscriptions.update(input.subscriptionId, {
      items: [
        {
          ...(item ? { id: item.id } : {}),
          price_data: {
            currency: CURRENCY,
            product: input.productId,
            unit_amount: input.plan.priceMonthlyCents,
            recurring: { interval: "month" },
            ...(this.options.automaticTax ? { tax_behavior: "exclusive" as const } : {}),
          },
        },
      ],
      metadata: { ...current.metadata, plan: input.plan.id },
      proration_behavior: "create_prorations",
    });
    return snapshot(updated);
  }

  async getSubscription(id: string) {
    try {
      return snapshot(await this.stripe.subscriptions.retrieve(id));
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) return null;
      throw error;
    }
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): BillingEvent | null {
    if (!signature) return null;
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.options.webhookSecret);
    } catch {
      return null;
    }
    return toBillingEvent(event);
  }
}

export function toBillingEvent(event: Stripe.Event): BillingEvent {
  const object = event.data.object as unknown as Record<string, unknown>;
  const result: BillingEvent = {
    id: event.id,
    type: event.type,
    customerId: idOf(object.customer as string | { id: string } | null),
    subscriptionId: null,
    checkout: null,
  };
  if (event.type.startsWith("customer.subscription.")) {
    result.subscriptionId = (object as unknown as Stripe.Subscription).id;
  } else if (event.type === "checkout.session.completed") {
    const session = object as unknown as Stripe.Checkout.Session;
    result.subscriptionId = idOf(session.subscription);
    result.checkout = {
      tenantId: session.metadata?.tenant_id ?? session.client_reference_id ?? null,
      setupFee: session.metadata?.setup_fee === "1",
      paid: session.payment_status === "paid",
    };
  } else if (event.type.startsWith("invoice.")) {
    const invoice = object as unknown as Stripe.Invoice;
    const parent = invoice.parent?.subscription_details?.subscription;
    result.subscriptionId = idOf(parent ?? null);
  }
  return result;
}

export function createBillingFromEnv(env: NodeJS.ProcessEnv = process.env): BillingProvider | null {
  const secretKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) return null;
  return new StripeBilling({ secretKey, webhookSecret, automaticTax: env.STRIPE_AUTOMATIC_TAX === "true" });
}
