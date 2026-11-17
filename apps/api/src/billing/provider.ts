/**
 * Payment provider for subscriptions (docs/PLAN.md §14, Phase 2). The API talks to this interface
 * only, so the provider can be replaced (PLAN §18.4); Stripe is the one built (`stripe.ts`).
 * Amounts are in CAD cents.
 */

export interface BillingPlan {
  id: string;
  nameEn: string;
  nameFr: string;
  priceMonthlyCents: number;
  /** The plan's product at the provider, if it was already created. */
  productId: string | null;
}

export interface CheckoutInput {
  attemptId: string;
  expiresAt: number;
  tenantId: string;
  customerId: string;
  productId: string;
  plan: Pick<BillingPlan, "id" | "priceMonthlyCents">;
  /** One-time setup fee added to the first payment (0: none). */
  setupFeeCents: number;
  language: "en" | "fr";
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  id: string;
  url: string | null;
  status: "open" | "expired" | "complete";
  subscriptionId: string | null;
}

/** What we keep of a subscription: everything else stays at the provider. */
export interface SubscriptionSnapshot {
  id: string;
  customerId: string;
  /** From the subscription's metadata, written at checkout. */
  tenantId: string | null;
  planId: string | null;
  status: string;
  priceMonthlyCents: number | null;
  currentPeriodEnd: Date | null;
  /** When a cancelled subscription stops; null while it renews. */
  cancelAt: Date | null;
}

/** A verified webhook event, reduced to what the sync needs. */
export interface BillingEvent {
  id: string;
  type: string;
  customerId: string | null;
  subscriptionId: string | null;
  /** Checkout finished: the tenant from its metadata, and whether the setup fee was in it. */
  checkout: { tenantId: string | null; setupFee: boolean; paid: boolean } | null;
}

export interface BillingProvider {
  readonly id: string;
  /** Header that carries the webhook signature. */
  readonly signatureHeader: string;
  createCustomer(input: { tenantId: string; name: string; email: string | null }): Promise<string>;
  /** Creates the plan's product at the provider; returns its id. */
  createProduct(plan: BillingPlan): Promise<string>;
  /** Create or recover the session for this attempt using the provider idempotency key. */
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  getCheckout(id: string): Promise<CheckoutSession>;
  findCheckouts(customerId: string, attemptId: string | null): Promise<CheckoutSession[]>;
  expireCheckout(id: string): Promise<void>;
  /** The provider's page where the owner updates the card, sees invoices and cancels. */
  createPortal(input: { customerId: string; returnUrl: string; language: "en" | "fr" }): Promise<string>;
  /** Moves a subscription to another plan, prorated, at that plan's current price. */
  changePlan(input: {
    subscriptionId: string;
    productId: string;
    plan: BillingPlan;
  }): Promise<SubscriptionSnapshot>;
  getSubscription(id: string): Promise<SubscriptionSnapshot | null>;
  /** Checks the signature and reads the event; null when it isn't from the provider. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): BillingEvent | null;
}
