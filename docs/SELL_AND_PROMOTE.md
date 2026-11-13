# Sell and promote: design

Status: phase 1 built (November 2026); phases 2 to 4 are a draft for review. Related: PLAN §3 (principles), §5
(scope policy), §7.1 (business page), §14 (roadmap); README, "Urgent problems (triage) and buttons in
answers".

## 1. Goal and constraints

Today the assistant answers questions and passes requests on. The owner wants it to also **help the
business sell and promote**: a visitor who asks about a service should leave with an obvious next step
for that service, a running offer should reach the visitors it matters to, and the owner should see
which services and offers people act on.

Constraints:

- **Nothing invented** (PLAN §7.1). Prices, discounts, stock and availability come only from what the
  owner entered. The assistant never negotiates, never makes up an offer, never promises a slot.
- **Helpful, not pushy.** One suggestion when it fits the question; none in urgent, danger, advice or
  complaint conversations; none after the visitor declined.
- **Works on every model.** Buttons are text markers the engine checks, as today
  (`[[action:call]]`), so a model without tool calling still sells. No feature depends on one provider.
- **No new consent problems.** Everything in phases 1–2 happens inside a conversation the visitor
  started. Messages sent *to* customers (SMS, email campaigns) need consent under CASL and are left to
  the phone and SMS phase.
- **Cheap.** No extra model call per answer. Offers and services ride in the prompt that is already
  sent; button taps are counted without a model.

## 2. What exists today, and the gaps

| Area | Built | Gap |
|---|---|---|
| Services and products | `catalog_items` with name, description, price text, category, photo and a card action (`ask`, `quote`, `book`). Cards on the page; the whole list is in every prompt | In the chat the assistant can only *describe* a service. The card's "Request a quote" / "Book" exists on the page but not under an answer |
| Buttons in answers | `[[action:call]]`, `[[action:book]]`; links come from the business profile | Not tied to a service: a tap says nothing about *what* the visitor wanted |
| Requests | `request_follow_up` tool saves a lead (kind `quote`, `booking`, …) with details | The lead doesn't reference the catalog item, so "3 quote requests for winter tire storage" can't be counted |
| Notices | `notices`: free text with start and end dates; in the prompt as `<notices>`, mentioned "when it matters" | No structure: no link to a service, no button, no code, and no way to tell an offer from "closed Monday" |
| Statistics | `page_stats`: daily totals of views and contact-button taps; questions and requests per day | Totals only. Nothing per service or per offer, and taps on buttons *in answers* aren't counted at all |
| Suggested questions | Quick replies under the greeting, set by the owner | Static: they don't change when an offer is running |

In short: the page can sell (cards with buttons), the chat can't, and neither can tell the owner what
sold.

## 3. Design

```
 OWNER                          VISITOR                               OWNER
 ─────                          ───────                               ─────
 services ─┐                    asks about a service                  Business page tab:
 offers  ──┼─▶ prompt ─▶ answer + [[action:quote:s3]] ─▶ button ─▶    per service / offer:
 (dates,   │             answer + [[offer:o1]]        ─▶ offer card   shown · tapped · requests
  service) │                          │ tap
           │                          ▼
           └────────────▶ request_follow_up(kind, item) ─▶ lead with catalog_item_id / offer_id
```

### 3.1 Sell: a next step for the service the visitor asked about

- **Item buttons.** The model may end a reply with one marker naming a service from `<services>`:
  `[[action:quote:s3]]`, `[[action:book:s3]]` or `[[action:ask:s3]]` (`s3` is the item's short id in
  the prompt, like photo ids today). The engine checks the id against the offered list, drops anything
  else, and sends a button:
  - `quote` → "Request a quote for Winter tire storage": starts the quote request in the chat with the
    item already filled in;
  - `book` → the business's booking link when there is one, otherwise a booking request for the item;
  - `ask` → for a related service the visitor didn't ask about ("Ask about wheel alignment").
  The button the owner chose for the card (`catalog_items.action`) is the default; the model can only
  pick among the item's allowed actions, never invent one.
- **Requests know their item.** `request_follow_up` gets an optional `item` argument (the same short
  id); the lead stores `catalog_item_id`. The Requests tab shows the service on the request, and the
  owner's notification email names it.
- **Related services, at most one.** The owner can mark "goes well with" on a service (winter tires →
  storage; furnace tune-up → maintenance plan). When the visitor asked about the first, the assistant
  may mention the second once, with its `ask` button. No relation set → no cross-sell. This is
  owner-written, not model judgement, so it can't drift into pushing.
- **Prices stay text.** "from $120" is said as written. The existing `prices` eval category (no price
  or discount beyond what the business wrote) covers the new paths.

### 3.2 Promote: offers that reach the right visitor

- **Offers are structured notices.** A notice gets optional fields: `kind` (`notice` | `offer`),
  `title`, `catalog_item_id`, `code` (a word the customer says or types), and an action (`ask`,
  `quote`, `book`, `call`). "Closed Monday for the holiday" stays a plain notice; "Winter tire
  changeover, $20 off until Nov 30" becomes an offer. Start and end dates already exist and already
  keep expired ones out of the prompt.
- **On the page:** a running offer shows as a banner above the services, with its button, and as a
  badge on its service's card.
- **In answers:** the model may add `[[offer:o1]]` when the visitor's question is about that offer's
  service, or asks about prices, deals or what's new. The engine renders an offer card (title, text,
  end date, button) under the reply, so the wording and the date are the owner's, not the model's.
  Rules in the prompt: at most one offer per conversation unless the visitor asks; never in urgent,
  danger, advice or complaint conversations; never present an offer as applying to something it isn't
  attached to.
- **Suggested questions follow offers.** While an offer runs, its title is added as a quick reply
  ("Winter tire changeover offer"), embedded on save like the others.
- **A share kit for each offer** (owner portal): the page link with `?offer=<id>` that opens the page
  on the offer, a QR code for the counter or an invoice, and a short post text the owner can copy to
  Facebook or Google. The post text is drafted by the auxiliary model *from the offer's own fields*
  and edited by the owner before use; nothing is posted for them. This is the first piece of the
  "content studio" in the agreed order, kept to what an offer needs.

### 3.3 Measure: what was shown, tapped and requested

- **Events, per item and per offer.** A small table of daily counts keyed by `(bot, day, target kind,
  target id, event)` with events `shown` (card or button rendered in an answer, or offer banner seen),
  `tapped`, and `requested` (a lead referencing it). Totals only, no visitor identity, like
  `page_stats`. Page-card taps and answer-button taps are counted separately (`surface`: page | chat).
- **Owner view** (Business page tab): a table of services and offers with shown → tapped → requests
  for the last 7 and 30 days, and for an offer its totals over its run. This is the number that shows
  the assistant is selling: "Winter tire storage: asked about 41 times, 9 quote requests".
- **Operator view:** the same per business, for pilot reviews.
- **Offer links** (`?offer=`) count as a `shown` with surface `link`, so the owner sees whether the QR
  code on the counter did anything.

### 3.4 What stays out

- No checkout, cart, payment or deposit in the chat (payment links are roadmap Phase 2).
- No stock or live availability; "Book" opens the business's own booking link or takes a request.
- No outbound messages to customers (SMS, email campaigns, review requests): needs consent handling
  and telephony, so it belongs with the phone and SMS phase.
- No automatic posting to social networks or Google Business Profile.
- No per-visitor tracking or retargeting. Counts are daily totals.

## 4. Data model

| Change | Purpose |
|---|---|
| `leads.catalog_item_id`, `leads.notice_id` (nullable, `on delete set null`) | A request knows the service and the offer it came from |
| `notices.kind`, `title`, `catalog_item_id`, `code`, `action` (all optional; `kind` defaults to `notice`) | Offers without a new table; existing notices keep working |
| `catalog_items.related_item_id` (nullable) | The one "goes well with" service |
| New `offer_stats` (name open): `tenant_id, bot_id, day, target_kind, target_id, surface, shown, tapped, requested`, primary key on the first six | Daily funnel counts; RLS like `page_stats` |
| `messages.flags.actions` gains `itemId` / `offerId` | Buttons come back with the conversation history, as today |

All tenant tables keep RLS through `withTenant`.

## 5. Engine and prompt

- `<services>` lines get a short id and their allowed actions; `<notices>` splits into `<notices>`
  and `<offers>` (id, title, text, ends, service id).
- The marker filter (`markers.ts`) already strips `[[action:…]]` and `[[photo:…]]` from the stream; it
  learns the two new forms. Unknown ids and disallowed actions are dropped silently and logged.
- `done.flags.actions` carries `{ kind, href?, itemId?, offerId?, label }`. Labels are built by the
  platform from the item's name in the visitor's language, never by the model.
- A tap on a `quote`/`book` request button sends a fixed message into the chat ("I'd like a quote for
  Winter tire storage"), the same path the page cards use today, with the item id attached so the
  request tool receives it even if the model forgets to pass it.
- Tap counting: a public endpoint like the existing page-stats one, rate-limited, accepting only ids
  that belong to the assistant.

## 6. Measuring it (evals)

New cases in `packages/evals`, EN and FR, for both test businesses:

| Category | Checks |
|---|---|
| **sell** | A question about a listed service gets that service's button (right item, allowed action); a quote request started from it saves a lead with the item |
| **offer** | A question about the offer's service shows the offer card; an unrelated question doesn't; an expired offer is never mentioned; the reply never states a discount other than the offer's text |
| **restraint** (safety, must all pass) | No offer or cross-sell in urgent, danger, advice and complaint conversations; no second offer after "no thanks"; no invented offer when none is running ("do you have any deals?" → says none are listed) |

The existing `prices` and `scope` categories run unchanged. Bar: the current 80 % for `sell` and
`offer`; `restraint` joins the safety set (no failures).

## 7. Phases

| Phase | Work | Size |
|---|---|---|
| **1. Sell in the chat** (built) | Item ids and actions in the prompt; `[[action:<kind>:<item>]]` buttons; `leads.catalog_item_id` and the item on requests and emails; chat page rendering; `sell` and `restraint` evals | 2–3 days |
| **2. Offers** | Notice fields and admin editor; offer banner and card badge on the page; `[[offer:<id>]]` cards in answers; quick reply while running; `offer` evals | 2–3 days |
| **3. Funnel statistics** | `offer_stats` table, tap endpoint, owner and operator views, `?offer=` links | 2 days |
| **4. Share kit and related services** | QR code and link per offer; post text drafted from the offer; "goes well with" on services | 1–2 days |
| Later | Payment and deposit links (roadmap Phase 2); outbound offers and review requests with consent (phone and SMS phase) | — |

Phases 1 and 2 are independent of each other; 3 is more useful after either.

### Phase 1 as built

- **Markers:** `[[action:quote:s3]]` and `[[action:book:s3]]`; `s3` is the item's place in
  `<services>`. The engine shows only the button the owner chose for that item's card, one item per
  reply, and each item's button once per conversation (models repeated it under every later reply,
  also after the request was passed on).
- **"Ask about this" items get no button** under an answer: the visitor is already asking. The
  `ask` button for a *related* service waits for phase 4.
- **Book** opens the business's booking link when it has one; without one it asks for the booking in
  the chat, like Quote.
- **No service button on an urgent problem or an advice request:** enforced by the engine from the
  triage, not left to the model. Complaints rely on the prompt rule and the `restraint` evals.
- **Requests:** `leads.catalog_item_id` and `leads.item_name` (the name as it was, kept when the item
  is renamed or removed). The model passes the item to `request_follow_up`; when it doesn't, a quote
  or booking request takes the item whose button of that kind was last shown in the conversation.
  The service is shown on the Requests tab and in both notification emails.
- **Evals:** 7 `sell` and 5 `restraint` cases (EN and FR), all passing with DeepSeek V4.1 Flash.
- Not built in phase 1: counting taps (phase 3).

## 8. Open decisions

1. **Order.** Recommended: phase 1 first. It needs no new owner input (services are already entered)
   and every pilot benefits the day it ships; offers need owners to write offers.
2. **How forward the assistant is by default.** Recommended: a button only for the service the
   visitor asked about; cross-sell and offers only where the owner set them up. A per-assistant
   setting ("suggest related services: off / when relevant") can come later if pilots ask.
3. **Offer codes.** A code the customer mentions ("say WINTER20") is simple and needs no checkout,
   but the business must honour it by hand. Alternative: no codes at first, the offer card alone.
4. **Statistics granularity.** Daily totals (recommended, same privacy stance as page statistics) or
   per-conversation attribution (richer, but stores what each visitor tapped).
5. **Is "offer" a plan feature?** It could be part of every plan (recommended for pilots) or an
   add-on later, like Email notifications.
