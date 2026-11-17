# Agency panel (resellers): design

Status: phase 1 in progress (November 2026): agencies, access, clients, team, branding and the
operator tab are built (see "Phase 1, part 1 as built" in §10); agency billing is next. Related: PLAN §2.2 (go-to-market), §7.4 (client
admin portal), §7.5 (operator console, support access, demo generator), §10 (data model), §16
(business model: "Agency / white-label" row), §18.4 (rules to respect while building). Stripe
behaviour below is marked *(verify)* where it must be confirmed before it is relied on.

Decisions taken for this plan:

- **Two billing modes, side by side, chosen per client.** An agency can have clients in both.
  - **Client pays (SaaS mode).** The agency sets its own retail prices, at or above a minimum price
    per plan. **We charge the client every month** through our own Stripe account, with the agency's
    name on the checkout and invoices. We keep **a percentage of each payment** and **pay the agency
    the rest on a fixed payout date**, the same for every agency, not payment by payment.
  - **Agency pays (wholesale).** We charge the agency one monthly subscription for all its wholesale
    clients, at our wholesale price per plan. The agency bills those clients itself, outside our
    system, at whatever price it wants.
- **Multi-currency:** each agency works in one currency (CAD, USD or another currency Stripe
  supports): its retail prices, wholesale invoices and payouts are all in it.
- **White-label in two steps:** branding first, the agency's own domains later.
- **Later, not now:** taxes on both sides, partner terms and the data processing agreement.

## 1. Goal and constraints

Local web design, SEO and marketing agencies sell our business page and assistant to their clients
under their own name, the way agencies resell GoHighLevel. An agency signs up once and gets an
**agency panel**. From it, the agency creates and manages any number of client businesses and
decides, client by client, who pays us: the client, at the agency's price (and the agency earns a
share), or the agency itself, at our wholesale price.

Constraints:

- **A client is an ordinary business.** Every client is a `tenants` row with its own assistants,
  knowledge, inbox and RLS, exactly like a direct customer. Nothing in the chat engine, page,
  knowledge or phone code changes. The agency layer sits above tenants, like the operator console.
- **One payer per client at any time.** A client-pays client has its own `billing_accounts` row and
  subscription; an agency-pays client has none and counts in its agency's wholesale subscription.
  Switching modes hands over at a period boundary, so a client is never billed twice or not at all
  (§3.5).
- **The agency is paid from a ledger, not from each charge.** Every paid client-pays invoice adds the
  agency's share to a ledger; refunds and disputes subtract from it. A payout run sends the available
  balance on the payout date. Splitting each payment at charge time (a Stripe Connect application
  fee) is left out (§9).
- **The two flows stay separate.** What the agency earns (ledger, payouts) and what it owes
  (wholesale subscription) are separate Stripe flows, not netted automatically (§11).
- **Agencies never see each other**, and a client of one agency is invisible to every other agency.
  Unknown ids answer 404, as tenant routes do today.
- **Direct customers are unaffected.** A business with no agency keeps its prices, Billing page and
  "Powered by" exactly as today.
- **Staff accounts stay separate.** Agency users are ordinary business users; a super admin can't
  join an agency (same database rule as for businesses).
- **Owner data belongs to the business.** An agency manages a client; it does not own the client's
  conversations, leads or contacts. A client can leave the agency and keep its data (§6.4).

## 2. What exists today, and the gaps

| Area | Built | Gap |
|---|---|---|
| Businesses | `tenants` (kind business / demo), `memberships` with owner / admin / editor / viewer; a user can belong to several businesses | No grouping above a business; nothing says "these 40 businesses belong to agency X" |
| Access across businesses | Super admins reach any business with the support role (`requireTenantRole`, `request.tenant.support`), with a Support mode banner and audit to both logs | Only Traiblazer staff. An agency user would need a membership in every client, added and removed by hand |
| Building a client | Onboarding wizard, onboarding chat, setup assistant, prospect demo generator with hand-over (§7.5) | Demo builder and hand-over are operator-only |
| Plans and prices | `plans` with allowances, one CAD retail price and setup fee; operators edit them | No per-agency retail price, no percentage we keep, no minimum price, no wholesale price, no "plans this agency may sell" |
| Billing | One Stripe customer + subscription per business (`billing_accounts`), checkout, webhook sync, Billing page | Checkout only knows the plan's own price; nothing records who earned what; nothing bills one customer for many businesses |
| Paying anyone | Nothing | No connected payee accounts, no ledger, no payout runs, no statements |
| Branding | `poweredBy: true` hard-coded on the page and in chat; our logo and name in the portal and emails | No per-business or per-agency brand |
| Cross-business stats | Operator overview: businesses, questions, cost this month | Operator-only, over all businesses |

## 3. Design

```
 CLIENT-PAYS CLIENT              US (platform)                          AGENCY
 ──────────────────              ─────────────                          ──────
 Billing page: agency's    ─▶  client's subscription (our account)
 plans at agency's prices      invoice paid ──▶ ledger: + agency share
 pays every month              refund / dispute ─▶ ledger: − share
                                    │
                                    ▼ fixed payout date
                               payout run: available balance ─▶ transfer ─▶ agency's connected
                                                                            account ─▶ its bank
 AGENCY-PAYS CLIENT
 ──────────────────
 no Billing page           ─▶  agency's wholesale subscription      ◀── agency pays every month
 ("managed by Acme")           one line per plan, quantity =            by card (its own invoice)
                               agency-pays clients on that plan
```

### 3.1 Agency accounts

- **Sign-up is reviewed.** An agency applies from a public "Partners" page (name, website, contact,
  country, expected number of clients). Operators approve it in a new **Agencies** tab of the console
  and set its currency, our percentage, wholesale price overrides if any, the plans it may sell, and
  which billing modes it may use. Reviewed because we pay money out to agencies and give wholesale
  credit: an unreviewed agency could run stolen cards through its own clients and be paid for them.
- **Payout account** (client-pays only). Before its first payout the agency connects a payout account
  through Stripe's hosted onboarding (Stripe Connect Express: Stripe collects the identity, business
  and bank details and does the checks; we never see bank numbers) *(verify: Express availability for
  Canadian and US agencies, and fees per active account and per payout)*. Until it is connected,
  earnings build up in the ledger and nothing is paid.
- **Wholesale payment method** (agency-pays only). The agency starts its wholesale subscription with
  a card through Stripe Checkout the first time it puts a client on agency-pays.
- An agency user can also own their own business (the agency's own page). It is a normal client of
  their agency, or free if the operator marks it as the agency's demo account.

### 3.2 The panel (`/agency` in the admin app)

1. **Overview:** clients by plan and billing mode, this month's questions and requests across all
   clients, **earnings** (this period, available, pending, next payout date), **wholesale** (next
   invoice total), and alerts per client: payment failed, near or over its question allowance, open
   knowledge gaps, page not published.
2. **Clients:** search and filter by plan and mode; **New client** (name, industry pack, plan,
   language, **billing mode**) then one of: the onboarding wizard, the onboarding chat, or the setup
   assistant from a website (the demo generator's flow, now open to agencies); **Open** (the client's
   admin portal with an agency banner, §4); change plan; switch billing mode (§3.5); suspend /
   reactivate; **Invite owner** (for client-pays: the owner subscribes on the Billing page, or the
   agency sends a **payment link** so the owner can pay without an account); **Release** (§6.4).
   Each row shows plan, mode, subscription status, price, questions this month and requests. An agency
   may record, for an agency-pays client, what it charges that client, for its own margin report.
3. **Prices** (client-pays): for each plan the agency may sell, its monthly retail price and an
   optional setup fee, with the plan's minimum price, our percentage and the agency's earning per
   client shown next to them, and the wholesale price for comparison. A price below the plan's
   minimum is refused. Changes apply to new subscriptions; existing clients keep their price until
   they change plan (as for direct customers today) or the agency moves them explicitly.
4. **Earnings and payouts** (client-pays): the ledger by period (each paid invoice, refund and
   dispute, per client), the next payout date, past payouts with a downloadable statement, and the
   payout account status with a link to Stripe's dashboard for the agency.
5. **Wholesale billing** (agency-pays): the subscription's lines (plan, quantity, wholesale price),
   the next invoice, past invoices and the payment method, through Stripe's customer portal.
6. **Templates** (phase 2): save a set-up client as a template (bot settings, appearance, modules,
   Q&A pairs, services list, page sections, onboarding questions; never conversations, leads,
   contacts or photos of people) and start new clients from it, like GoHighLevel's snapshots.
7. **Team:** invite agency users with an agency role (§4.1).
8. **Branding:** agency name, logo, brand color, support email and website, "Powered by" choice (§5).

### 3.3 Client pays: charging clients

- **The client's Billing page** (today's page) lists the plans its agency sells, at the agency's
  prices, with the agency's branding. Checkout and the Stripe customer portal work as today; the
  subscription is on our Stripe account with `tenant_id`, `agency_id` and the price in its metadata.
- **Prices at Stripe, in the agency's name:** each agency gets its own Stripe product per plan, named
  with the agency's name and its plan name ("Acme Agency – Business Page"), with the agency's retail
  price in its currency, created on first use like plan products today; `agency_prices` keeps the
  ids. Checkout, invoices, receipts and the customer portal show that product name, and the card
  charge carries the agency's name as a statement descriptor suffix *(verify: dynamic descriptor
  suffix on subscription invoices, and what Checkout's header shows)*. We remain the seller of record
  and the one who charges the card every month.
- **Minimum price:** operators set a minimum monthly retail price per plan and per currency
  (platform policy). It keeps our percentage worth having and stops agencies undercutting our direct
  prices by too much.
- **Failed payments** follow today's path for direct customers: Stripe retries, the owner sees a
  warning, the agency sees an alert, and the client's status follows the subscription.

### 3.4 Client pays: ledger and payout runs

- **Shares.** Our share is **a percentage of each paid invoice** (before tax), set per agency by
  operators (default from platform policy, e.g. 30 %), with an optional different percentage per
  plan. The agency earns the rest. It applies the same way to pro-rated invoices and to setup fees.
  Payment processing fees are paid from our share; the percentage is set with them in mind. Each
  ledger entry records the percentage and the amounts at payment time, so a later change of
  percentage or price never rewrites history.
- **Ledger** (`agency_ledger`): one entry per event, from the Stripe webhook: `earning` (invoice paid),
  `refund` (negative), `dispute` (negative when opened; reversed if won), `adjustment` (operator, with
  a reason). Each entry has its client, invoice, amount in the agency's currency (minor units) and an
  **available on** date. Agency-pays clients never create ledger entries.
- **Hold.** An earning becomes available **14 days after payment** *(operator policy)*, to absorb
  most refunds and early disputes before the money leaves. Later refunds and disputes are negative
  entries that reduce the next payout.
- **Payout run.** One fixed payout date for every agency, set by operators in platform policies
  (recommended: monthly on the 15th, covering earnings available by then). On that date a worker job
  pays every agency: it sums available, unpaid entries; if the total is at least the minimum (default
  50 in the agency's currency) and the payout account is ready, it creates one Stripe transfer to the
  agency's connected account, marks the entries paid with the payout id, and saves a statement.
  Stripe then pays the agency's bank on the connected account's own schedule. Below the minimum, or
  with a negative balance, the amount carries to the next run.
- **Idempotent and auditable.** A payout is a row created before the transfer, with an idempotency
  key; a rerun after a crash finds it and never pays twice. Operators can hold an agency's payouts
  (suspicion of fraud, open disputes, unpaid wholesale invoices) and see every run in the console.
- **Negative balances** (an agency's refunds and disputes larger than its earnings) carry forward. If
  an agency leaves with a negative balance, operators recover it by invoice *(verify: whether we may
  debit a connected account in Canada)*.

### 3.5 Agency pays: wholesale subscription

- **One wholesale subscription per agency**, on our Stripe account in the agency's currency, with one
  line per plan; each line's **quantity is the number of billable agency-pays clients on that plan**.
  Adding a client, changing its plan, suspending or releasing it updates the quantities, with
  proration *(verify: proration and invoice timing for quantity changes mid-period)*. The products are
  ours ("Business Page – wholesale"); only the agency sees these invoices.
- **Wholesale prices** are set by operators per plan and per currency (platform policy), with an
  optional per-agency override. No setup fee: agencies set up their own clients.
- **Unpaid wholesale invoice:** Stripe retries; when the subscription is `past_due` the panel warns,
  the agency's payouts are held, after 14 days *(operator policy)* new agency-pays clients are
  blocked, and after 30 days operators decide whether to suspend those clients. Clients are never
  suspended automatically: their customers would see a dead page over the agency's billing problem.
- **The client's portal** hides the Billing page: "Your plan is managed by Acme Agency".

### 3.6 Trials and switching modes

- **Trial:** a new client, in either mode, gets the trial plan, as a direct customer does. The agency
  can extend a client's trial once by up to 30 days *(operator policy)* and has a cap on clients in
  trial at once (default 10) so trials can't be farmed. An agency-pays client becomes billable (joins
  the quantity) when the agency gives it a paid plan or when its trial ends, whichever comes first.
- **Client pays → agency pays:** the client's subscription is set to end at its period end; at that
  moment the client joins the wholesale quantity. No credit or refund in between.
- **Agency pays → client pays:** the owner subscribes (Billing page or payment link). From the start
  of that subscription the client leaves the wholesale quantity (prorated). Until the owner pays, it
  stays on agency-pays.
- Every switch is in the agency's and the client's audit logs.

## 4. Access and permissions

- **No memberships in client businesses.** `requireTenantRole` gets a third path next to members
  and super admins: if the business has `agency_id = A` and the user is a member of agency A with
  access to that client, `request.tenant = { id, role, via: "agency" }` (today's `support: boolean`
  becomes `via: "member" | "support" | "agency"`). RLS is unchanged: the route still runs inside
  `withTenant(clientId)`.
- **Audit:** every change made through the agency path goes into the client's own audit log
  ("by Jane, Acme Agency") and into the agency's audit log, like support changes today.
- **The portal shows an agency banner** in a client ("Acme Agency manages this business") instead of
  the Support mode banner. The Billing page shows the agency's plans and prices for client-pays
  clients, and is hidden for agency-pays clients.
- **Agency users can't pay for or cancel a client-pays subscription**; only the client's owner can
  (the card is theirs). The agency sees the status and can send a payment link.

### 4.1 Agency roles

| Agency role | Agency panel | In client businesses |
|---|---|---|
| owner | everything: prices, payouts and payout account, wholesale billing, branding, deleting the agency | admin in all clients |
| admin | everything except prices, payouts, wholesale billing and agency deletion | admin in all clients |
| member | Overview and Clients, only for assigned clients (phase 2; all clients in phase 1); no money | admin in assigned clients |

A client's own owner is a normal `memberships` owner of that business. They can do everything an
owner does today, and they can't remove the agency's access (only a release, §6.4, ends it).

### 4.2 Cross-client views

The Overview and Clients list read totals across the agency's clients. They use the same path the
operator overview uses today, filtered by `tenants.agency_id`, and read only aggregate tables
(`usage_counters`, `page_stats`, `leads` counts, `knowledge_gaps` counts, `billing_accounts` status),
never conversation text, across clients. Reading a client's inbox or leads happens only after
**Open**, inside that client.

## 5. White-label

**Phase 1: branding.**

- **Portal:** inside an agency client, and in the agency panel, the header shows the agency's logo
  and name, the brand color replaces ours, and help links point to the agency's support email.
  Login stays on our domain; a branded login link `/{lang}/p/{agency-slug}/login` shows the agency's
  logo before sign-in.
- **Checkout, invoices and card statement** (client-pays): the product is in the agency's name (§3.3)
  and the card charge carries its name as a descriptor suffix. Our account name may still appear in
  Checkout's header and as the descriptor prefix *(verify)*; the partner terms say so. Agency-pays
  clients never see a charge from us.
- **Page and chat:** `poweredBy` stops being hard-coded. For agency clients the agency chooses:
  nothing, or "Powered by Acme Agency" linking to its website. Our name never shows.
- **Emails** to the client (invitations, lead alerts, digests, payment warnings): sender name is the
  agency's, reply-to is its support email, the logo is its logo. The sending address stays on our
  domain until phase 3.
- **What stays ours:** the hosted page address (`<our-domain>/<slug>`), the embed script host, and
  the iOS / Android store apps (the PWA picks up the agency's name and icon from its manifest).

**Phase 3: domains.**

- **Portal domain** (`app.acme-agency.com`) and **page domain** (`pages.acme-agency.com/<slug>`, or a
  client's own domain, which PLAN §17.3 already plans for Phase 2): a CNAME to us, certificate issued
  on demand *(verify: Caddy on-demand TLS vs Cloudflare for SaaS; cost per hostname)*. The domain
  decides the brand before login, so the branded login link is no longer needed.
- **Sending domain:** the agency verifies its domain with our email provider (SPF / DKIM) and emails
  go from `notifications@acme-agency.com`.

## 6. Rules and edge cases

1. **Scope policy applies to every client** (PLAN §5). An agency can't switch off the scope checks or
   choose packs its plan doesn't include.
2. **Agency terms:** the agency accepts partner terms covering its share, payout date, wholesale
   prices and payment terms, holds and clawbacks of refunds and disputes, its responsibility for its
   clients' consent and content (CASL for any texting, the right to publish what is on a client's
   page), and a data processing agreement (the agency processes client data on the client's behalf).
3. **Suspending an agency** (operator) blocks its users from the panel and from every client and
   holds its payouts. Clients keep running (client-pays ones keep paying us); their customers
   shouldn't see a dead page over the agency's problem. Operators then release the clients or move
   them to another agency.
4. **Release and transfer.** A client leaves an agency by **release**: the agency releases it, or an
   operator does at the owner's request. The business keeps all its data and the agency's branding
   goes.
   - *Client-pays:* it keeps its subscription; at the next renewal it moves to our direct price for
     the same plan (the owner is told by email 30 days before, as for any price change *(verify
     notice rules)*), and the agency stops earning from invoices after the release date.
   - *Agency-pays:* it leaves the wholesale quantity at the end of the agency's current period, gets
     the trial grace period, and must start its own subscription on the Billing page.
   An existing direct customer joins an agency only by accepting the agency's invitation; it joins as
   client-pays (its subscription moves to the agency's price at the next renewal) or, if the agency
   chooses agency-pays, its own subscription ends at its period end and it joins the quantity then.
5. **Deleting an agency** requires no clients (each released), a settled ledger (final payout made,
   or negative balance recovered) and no unpaid wholesale invoice.
6. **Demos:** agencies can build prospect demos with the demo generator; on hand-over the demo becomes
   a client of the agency and starts its trial.
7. **Fraud signals** for operators: many new client-pays clients paying with cards from one country
   unrelated to the agency's, high dispute rate, clients with no page activity but paid plans.
   Holding payouts is the remedy; the 14-day hold is what makes it possible.

## 7. Data model

| Table / column | Kind | Key fields |
|---|---|---|
| `agencies` | platform | name, slug, country, currency, our percentage, modes allowed (client pays / agency pays), status (applied / active / suspended), trial cap, payouts held flag, branding (logo asset, color, support email, website, powered-by choice), timestamps |
| `agency_members` | platform | agency, user, role (owner / admin / member); unique (agency, user); staff accounts refused by the existing trigger rule |
| `agency_client_access` | platform | agency member, tenant (phase 2: assigned clients for the member role) |
| `agency_prices` | platform | agency, plan, retail monthly price and setup fee (client-pays), our percentage for this plan (null = the agency's), wholesale price override (null = platform price), Stripe product and price ids, active |
| `plan_currency_prices` | platform | plan, currency, minimum retail price, wholesale price, Stripe wholesale price id (operator-set) |
| `agency_payout_accounts` | platform | agency, Stripe connected account id, status (pending / ready / restricted), details submitted at |
| `agency_ledger` | platform | agency, tenant, kind (earning / refund / dispute / dispute_won / adjustment), Stripe invoice / charge / dispute id (unique per kind), invoice amount, our percentage, agency amount, currency, available on, payout id, note, created by |
| `agency_payouts` | platform | agency, payout date, amount, currency, status (created / sent / failed), idempotency key, Stripe transfer id, statement asset |
| `agency_wholesale_billing` | platform | agency, Stripe customer and subscription ids, status, current period end, subscription item id per plan |
| `agency_templates` | platform | agency, name, source tenant, snapshot JSON (phase 2) |
| `agency_audit_logs` | platform | agency, user, action, target tenant, details |
| `tenants.agency_id` | column | nullable FK; set = managed by that agency |
| `tenants.agency_billing_mode` | column | `client_pays` / `agency_pays` (null without an agency); a pending switch and its date |
| `tenants.agency_joined_at` | column | the agency earns from invoices paid after this date (and before a release) |
| `tenants.billable_since` | column | agency-pays: when the client joined the wholesale quantity |
| `tenants.agency_retail_note_cents` | column | agency-pays: what the agency says it charges the client (its margin report only) |
| `billing_accounts.agency_price_id` | column | client-pays: which agency price the subscription pays (null for direct customers) |

## 8. Operator console

A new **Agencies** tab: applications to approve or decline; each agency's clients and their modes,
currency, our percentage (and per-plan overrides), wholesale overrides, plans it may sell, modes
allowed, trial cap, payout account status, ledger, balance and payout runs, wholesale subscription
status; hold or release payouts; manual adjustments with a reason; suspend / reactivate; release or
move a client; every step in the operator audit log. The Businesses tab shows the agency a business
belongs to and its mode, and filters by them. Platform policies gain: default percentage, minimum and
wholesale price per plan and currency, payout date, hold days, minimum payout, maximum trial
extension, wholesale grace days.

## 9. Left out

- **Splitting each payment at charge time** (Stripe Connect destination charges with an application
  fee): the agency is paid seconds after each charge and Stripe handles more of the money flow. Left
  out for now because periodic payouts give a hold before money leaves, one transfer per period
  instead of one per payment, and a single statement the agency can reconcile. The ledger keeps the
  same numbers, so switching later changes only how the share is moved.
- **Netting wholesale invoices against payouts** automatically: kept separate in phase 1 (§11).
- **Payouts outside Stripe** (Interac e-Transfer, wire): only if an agency can't use Stripe Express;
  the ledger and statements work the same, and an operator marks the payout as sent by hand.

## 10. Phases

1. **Agencies, both billing modes and payouts.** Tables, operator Agencies tab, partner application,
   agency panel (Overview, Clients with billing mode, Prices, Earnings and payouts, Wholesale billing,
   Team with owner / admin), the agency access path in `requireTenantRole` with audit and banner, new
   clients through the existing wizard / chat / setup assistant, agency prices on the client's
   Billing page and payment links, payout account onboarding, ledger from webhooks, payout job on the
   fixed payout date, statements, wholesale subscription with quantities, mode switching, branding
   (logo, name, color, "Powered by" choice, email sender name). Tests: an agency user gets 404 on
   another agency's client and on direct businesses; an agency price below the plan's minimum is
   refused; shares by percentage, including per-plan overrides and pro-rated invoices; ledger entries
   for paid / refunded / disputed invoices; agency-pays clients never reach the ledger; quantities
   follow add / plan change / suspend / release / switch; a switch never leaves a client with two
   payers or none; a payout run twice pays once; held and below-minimum balances carry forward; RLS
   test for the new path. Run the first payouts in Stripe's test mode, then pay the first agency by
   hand-checked runs before turning the job on.
   **Phase 1, part 1 as built:** `agencies`, `agency_members`, `agency_audit_logs` and the agency
   columns on `tenants` (migration 0055; the staff-account guard covers agency members). The agency
   path in `requireTenantRole` (`via: "agency"`, role admin, only while the agency is active), audited
   in the client's log and the agency's. Partner application (`POST /v1/agencies`), operator Agencies
   tab (approve, decline, suspend, currency, our percentage with a platform default, billing modes,
   trial cap, payout hold). Agency panel at `/agency`: Overview, Clients (create with a billing mode,
   open, suspend / reactivate, add an existing account as owner), Team (owner adds admins and
   members), Branding, Activity. Clients start on the trial plan, capped per agency. An agency can't
   lift a suspension made by operators (`tenants.suspended_by`). Agency-pays clients see "managed by
   <agency>" on Billing and can't check out; client-pays clients use today's Billing page and prices
   until agency prices land. Page and chat credit the agency or no one, never us. The portal shows the
   agency's name and logo for its clients, and an agency banner to its users.
   **Not built yet:** agency prices and minimums, ledger and payouts, wholesale subscription, mode
   switching, release, email sender name, the phone top bar's brand.
2. **Running many clients.** Templates, member role with assigned clients, alerts, margin report,
   release / transfer flows, branded login link, demo generator for agencies, fraud signals in the
   console.
3. **Domains.** Portal and page domains with on-demand certificates; agency sending domain.

## 11. Decisions

Decided (November 2026):

1. **Both billing modes coexist**, chosen per client: client pays (SaaS) or agency pays (wholesale).
2. **Our share (client pays) is a percentage** of each paid invoice, set per agency, with optional
   per-plan overrides.
3. **One fixed payout date for all agencies**, set in platform policies.
4. **A minimum retail price** per plan and currency, set by operators.
5. **Client-pays products and invoices carry the agency's name**; we charge the client monthly.
6. **Multi-currency:** one currency per agency, from those Stripe supports.
7. **Taxes, payout documents, partner terms and DPA:** later, before the first real payout. Part of
   the legal review in PLAN §17.8, plus our accountant.

Still open:

1. **The numbers:** default percentage, wholesale prices, the payout date (recommended: monthly on
   the 15th), hold days (14 recommended), minimum payout (50 recommended), and each plan's minimum
   price per currency. Recommended rule of thumb: wholesale price ≥ minimum price × our percentage,
   so neither mode earns us clearly less than the other.
2. **Netting:** keep wholesale invoices and payouts separate (recommended for phase 1: two clear
   statements), or deduct an agency's wholesale invoice from its next payout.
3. **Can agencies see conversation text** in their clients? Recommended yes, as an admin (they run
   the assistant), stated in the partner terms and the client's privacy notice.
4. **A released client in a currency other than CAD:** move it to CAD direct prices at renewal, or
   add direct prices in that currency.
