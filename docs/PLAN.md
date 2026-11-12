# Traiblazer — Multi-Tenant AI Business Page and Chat Assistant Platform for Small Businesses

> Working name taken from the project folder. Status: **web chat platform and AI business page built
> (Phase 1, milestones 1.1–1.3 — see README); setup without a website (1.4) built except Google
> listing details (open decision §17.4); pilot readiness (1.5) in progress: page statistics, EN/FR evals and the prospect demo generator built;
> phone and SMS not started**.
> **v6 2026-11-10: chat first.** The first pilot product is the chat assistant with its **AI business page**:
> the hosted chat page works as the business's website, for businesses that have no site or an outdated
> one (§7.1). Phone and SMS move to a later phase. The audience is unchanged from v5.
> v5 2026-11-10: early-stage audience changed to five phone-driven industries in small and mid-sized
> Canadian cities (trades, auto shops, property management, clinics, professional services), from
> `Canadian SMB AI Agent Playbook.md`. Phone and SMS become the main channel, sold as a done-for-you
> service with a setup fee and monthly retainer. Restaurants, retail, salons and lodging stay available as
> self-serve web chat but are no longer the sales focus.
> v1 2026-11-04 · v2: multi-provider LLM layer; industries refined from the Northern Ontario market research
> (`Northern_Ontario_Business_AI_Research.xlsx`, Oct 2026, 451 businesses) · v3: go-to-market starts with
> local small businesses (clinics, legal, mining, auto moved later); multilingual support for newcomer
> languages; professional industries limited to customer service — no professional advice · v4: translation
> done by the LLM only (no separate translation service at launch); automotive split into repair shops,
> dealerships and manufacturers.

## 1. Product in one paragraph

A local business — a plumber, an HVAC or roofing contractor, an auto repair or tire shop, a property
manager, later a clinic or an accounting or law office — gets an **AI business page**: one link that works
as its website. The page shows who they are, what they offer (services or products, with photos and
prices), where they work and when they're open. In front sits an AI assistant that answers customers'
questions 24/7 from the business's **own content**, takes quote and booking requests with photos, flags the
urgent ones and passes them to the owner. A business with no website, or one that is years out of date,
**skips building a website**: we set the page up from whatever exists (a Google listing, a Facebook page, a
price list, a short interview) and it goes on the Google Business Profile, a QR code, the truck and the
invoice. A solo contractor gets the same thing as a personal page; a business that already has a good
website adds the same assistant to it as a widget. Answers come in English, French and the customer's own
language. **Phone and SMS answering come in a later phase** on the same engine (§7.3). The assistant is a
**customer-service assistant**: it answers questions about the business, takes requests and hands off — it
never gives professional advice. You (the operator) run one shared platform serving many businesses cheaply.

## 2. Target market and go-to-market order

**Launch market:** small and mid-sized Canadian cities and suburban hubs, starting in Ontario
(Kitchener-Waterloo, London, Kingston, Barrie, Guelph), then Kelowna, Halifax and the suburbs of the GTA and
Metro Vancouver. Start with **one or two cities and one industry** so references and word of mouth build up
in one place. The Northern Ontario research list (Thunder Bay, Sudbury, Sault Ste. Marie; 451 businesses)
stays as a second region and the bilingual EN/FR showcase, but trades and auto shops are under-represented
in it, so each launch city needs its own prospect list (§2.2).

**First product: the chat assistant and its AI business page.** It is built, it is cheap to run, and it
can be live for a business in a day. Phone and SMS answering are a later phase (§14), sold to the same
customers once the page has shown its value.

**Why these businesses** (assumptions to confirm in the pilots):

1. **Many have no website, or an outdated one.** A solo contractor or small shop often has only a Google
   listing and a Facebook page. A website project costs them money and weeks, and nobody maintains it
   afterwards. A page that is ready in a day and answers questions by itself skips that step.
2. **Every unanswered question is a lost job.** The owner is on a roof or under a car and can't answer;
   the customer moves on to the next business on Google Maps. One lost job is worth roughly $500–5,000+.
3. **Front-desk labour is expensive.** A receptionist or dispatcher costs $18–25/hour plus CPP, EI,
   WSIB/WorkSafe and vacation pay — over $3,500/month.
4. **They already pay for software monthly** (QuickBooks, Jobber, Jane App, Shopify), and **the owner
   decides alone**, usually in one conversation.

**Strategy for a small company: start where the sale is easy _and_ the risk is low.** All five industries
below are early-stage targets, but they aren't equally easy to serve. Trades and auto shops hold no
regulated data, so they go first. Property management adds tenant privacy questions. Clinics and
professional firms handle health, tax and legal information; they are served last, as customer service
only (§5), once a lawyer has reviewed the scope and privacy measures.

### 2.1 Early-stage segments

| Segment | Who | Phase | Main pain | What the page and assistant do | Watch out for |
|---|---|---|---|---|---|
| **1. Home services & trades** | HVAC, plumbers, electricians, roofers, landscaping / snow removal; many solo contractors | **1 — first pilots** | No website or an old one; the owner can't answer while on a job | Page with services, service area, photos of past work and prices. The assistant answers, checks the service area, takes quote requests with photos, flags urgent problems and shows the phone number | No diagnosis or binding prices; gas smell, carbon monoxide, no heat in winter → 911 / call now (§5) |
| **2. Auto repair & tire shops** | Mechanic shops, tire centres, body and glass shops | **1 — first pilots** | The same questions all day in the October–November winter-tire rush and the spring changeover | Page with services and the price list. The assistant answers tire and service questions, takes changeover and repair requests (vehicle, tire size), shares the booking link | "Estimate after inspection"; it can't see work orders until shop software is connected |
| **3. Property management & rentals** | Local property managers, student-housing landlords (Waterloo, Kingston, London), leasing agents | **2** | Maintenance requests at all hours; leasing spikes every April and August | Page with available units and how to apply. The assistant logs maintenance requests, flags emergencies, answers rental inquiries and takes showing requests | What a landlord may ask an applicant is limited by privacy and human-rights law; the assistant collects answers and never accepts or rejects anyone (§5, §12) |
| **4. Appointment clinics** | Dental, chiropractic, physio, medspas, vet clinics | **3** (design partners in Phase 2) | Front desk juggles walk-ins and ringing phones; no-shows | Page with services, team, fees and the booking link. The assistant answers published information and takes callback requests | Health information (PHIPA and provincial equivalents): Canada-only data, no health details in chat, lawyer review first. Vet clinics hold no human health information, so they can go first |
| **5. Professional services** | Accounting firms, real-estate lawyers, immigration consultants | **3** (design partners in Phase 2) | February–April tax season; staff answer the same questions and chase clients for missing documents | Page with services, fees, what to bring and how to book. Later: document chaser with a secure upload page | Customer service only (§5). Documents carry SINs → secure upload page, never chat or SMS |

**Design partners in Phase 2:** one or two clinics or firms with a page, the assistant and a booking link
only (no health or case details), to learn their workflow before the full packs ship.

**Also served, without outbound sales**

| Segment | Status |
|---|---|
| **Local businesses** — restaurants, cafés, retail, salons, lodging, attractions | Self-serve: sign up, add the website or build the page, paste the widget. The same product at a low price; a good offer for agency partners |
| **Car dealerships** | Phase 3 — inventory feeds, CRM and lead-response tooling |
| **Industrial & institutions** | Phase 4 — long enterprise sales, procurement, security reviews |

**Needs that come up in every early-stage industry:**

1. **A page that is ready without a website project** — from a Google listing, a price list, photos and a
   short interview.
2. **Show the offer, not only chat** — services or products, prices, photos, hours and area must be
   visible without asking a question (§7.1).
3. **Requests the owner can act on** — who, what, where, how urgent, with photos; by email now, by text later.
4. **Seasonal bursts** — winter tires (October–November), furnace/AC changeover, snow removal, tax season
   (February–April), student leasing (April, August) → seasonal notices and suggested questions.
5. **Urgent problems** — a burst pipe or no heat can't wait: show the phone number and mark the request urgent.
6. **English and French**, plus newcomer languages in chat (§6).
7. **Later: phone and SMS, and the tools they already use** — Jobber, Housecall Pro, Google Calendar, shop
   software (§7.3, §14).
8. **Canadian compliance** — CASL, PIPEDA and Quebec Law 25, AODA for the page; PHIPA for clinics (§12).

### 2.2 Go-to-market

1. **Prospect list — "Google Maps page 2".** Search `plumber`, `HVAC`, `roofing` or `auto repair` in the
   target city. Skip the sponsored results and businesses with fewer than 5 reviews. Target businesses
   ranked **6–25** with **4.2–4.8 stars** and **20–100 reviews**: busy and profitable. Put first the ones
   whose listing has **no website link, only a Facebook page, or a site that is clearly outdated** (not
   mobile-friendly, old prices, broken pages).
2. **Show, don't pitch: a demo page.** Before the first contact, the operator builds a private demo page
   from the prospect's public information (Google listing, Facebook page, old site) with the prospect
   demo generator (§7.5). The owner sees their own name, services and area, and can ask the assistant a
   question about their own business.
3. **First contact.** A visit or a phone call with the demo link is the lower-risk first touch.
   - A text or email to a business is a commercial electronic message under CASL. Send it only to an
     address or number the business publishes for inquiries, keep it relevant to that business, say who
     you are and how to reach you, and include a way to opt out. Have this checked before sending at
     volume (§12).
4. **The pitch.** "Your page is ready. It answers customers and takes requests while you work, for less
   than a website costs, and you never have to maintain it." With a $450 average ticket, one extra job
   pays for many months.
5. **Go live.** The owner approves the page; the link goes on the Google Business Profile, a QR code on the
   truck, invoices and cards.
6. **Channel partners.**
   - Local web design and SEO agencies: offer the page and assistant white-label or on revenue share, for
     clients who can't afford a full site and as a widget on the sites they build.
   - Bookkeepers and IT managed-service providers: 20 % recurring referral commission.
7. **Pilot goal:** 10–20 trades and auto businesses with a live page in one or two cities before adding the
   next industry. Then offer phone and SMS to the pilots that get the most requests.

**Data notes (Northern Ontario list):** revenue/employee figures in the sheet are benchmarks, not facts. One
row (a French-language law firm) has shifted columns; "Legal clinic (non-profit)" is filed under Health &
Wellness; suburban trades are under-represented; 22 websites were unreachable — check before reaching out.

## 3. Design principles

| Principle | How |
|---|---|
| **The chat page is the storefront** | The first product is a public page with the assistant in front; it replaces a website the business doesn't have. Phone and SMS are added later on the same engine |
| **Readable without chatting** | Services, prices, hours and contact details are ordinary page content; the assistant is the fast way in, not the only way |
| **An invisible layer over their tools** (Phase 2 on) | Read and write Jobber, Housecall Pro, Google Calendar, Stripe (later Jane App, shop software) through integrations; never ask the owner to adopt a new CRM or calendar |
| **Done-for-you setup** | We build the page and the knowledge base from whatever the business has (listing, price list, photos, interview); the portal and self-serve signup stay for those who want them |
| **Never a dead end** | Every answer leaves a way forward: a request to the owner, a booking link or the phone number; an urgent problem always shows the phone number |
| **Multi-tenant from day 1** | `tenant_id` on every table + Postgres Row-Level Security |
| **Configure industries, don't code them** | Sector → Pack → Variant built from reusable capability modules (§4) |
| **Customer service, not professional advice** | Platform-wide locked scope rule + classifier + evals (§5) |
| **Grounded answers, honest "I don't know"** | Answer only from tenant content; when it isn't there, take a message, transfer or capture a request instead of guessing |
| **One engine for every channel** | Voice, SMS and web chat run the same engine, knowledge and tools; only the reply format and the model profile differ (§8.3) |
| **Built for bursts on shared infra** | Shared stateless services, pay-per-use LLM and telephony, no per-tenant servers; many simultaneous conversations in seasonal peaks |
| **Multilingual by default** | Text channels answer in the customer's language; voice in English, then French (§6) |
| **Provider-agnostic** | LLM providers (§9), telephony and voice vendors all sit behind our own interfaces; the LLM also does all translation |

## 4. Industry structure

### 4.1 Model

```
Sector            e.g. Food & Drink
 └─ Pack          e.g. Restaurant & bar   (persona, guardrails, FAQ templates, onboarding questions, modules, scope level)
     └─ Variant   e.g. Pub                (overrides only: age gate, events, kitchen hours)
```

- **Pack** = persona & tone + scope level (§5) + guardrails + onboarding questions + starter FAQ templates
  - lead fields + quick replies + escalation keywords + enabled modules + eval set (multi-language).
- **Variant** inherits its pack and overrides only what differs.
- Versioned YAML in `packages/industry-packs`, schema-validated.
- **Templates, not fixed industries:** a pack is a *template*. Creating an assistant copies the
  template's response guidelines and **workflows** into the assistant; the business then owns that
  copy and can edit or turn off workflows, delete them, add suggested ones back, or write its own.
  A workflow is a playbook: *when* (the visitor's request), ordered *steps* (what to ask or mention)
  and how to *finish* (link, phone, later lead capture / handoff). Workflows are business text: they
  sit below the locked platform rules and can't add facts beyond the business's information.
  Assistants created before this keep following their template until edited.

### 4.2 Capability modules

**Chat assistant and business page — the first product**

| Module | What it does | Phase |
|---|---|---|
| **Business page** | The hosted chat page as the business's public page: header, contact buttons, hours, area, services, photos, with the assistant in front (§7.1) | built |
| **Services & products** | A list the owner keeps (name, description, photo, price text, category), shown as cards on the page and used by the assistant in answers | built |
| **Lead capture (requests)** | Contact + pack fields + preferred language; CASL consent for marketing | built |
| **Urgent request flag** | Pack keywords and questions sort urgent from routine. Urgent → the phone number shown at once, the request marked urgent, the owner emailed immediately (text alert in the phone and SMS phase), plus the safety message (911, gas utility) | built |
| **Quote request** | Guided questions + customer photos; price ranges only from the business's own price rules | built |
| **Service-area check** | Postal code or town checked against the business's service area | built |
| **Booking links** | Buttons and answers that link to the booking tool the business already uses | built |
| **Hours & seasons** | Regular, holiday, seasonal hours; "open now?" on the page and in answers | built (regular hours); holiday and seasonal hours: 2 |
| **Notices & live status** | Time-limited announcements on the page and in answers (closures, storm delays, "booking tire changeovers now"), auto-translated | built (the assistant translates in answers; page shows the owner's text) |
| **Human handoff** | Email alert to the owner with the request and the conversation | built |
| **Knowledge gaps** | Questions the assistant couldn't answer, grouped, with "answer it" | built |
| **Setup assistant** | Proposes business details, the page description, services and products with the prices found in the sources, greeting and FAQs from the website, notes, uploaded price lists or brochures and the interview answers (built) | built |
| **Image upload** | Customer photos in chat via vision models | built |
| **Multilingual** | Answers in the customer's language; EN/FR page and admin (§6) | built |
| **Safety & escalation** | Emergency keywords → urgent message + phone; crisis lines (9-8-8, 911) | built |
| **Page sharing** | QR code, friendly link, search-engine basics; own domain | built (own domain: 2) |
| **Job & appointment booking** | Real availability and booking through Google Calendar and Jobber; Housecall Pro, Cal.com and Calendly next | 2 |
| **Payment and deposit links** | Stripe links in answers and requests | 2 |
| **Seasonal scripts** | Scheduled switch of greeting, notices and suggested questions (AC → furnace, landscaping → snow removal, winter tires) | 2 |
| **Maintenance requests** | Tenant requests logged with unit, problem, photos and urgency; the manager is alerted | 2 |
| **Rental inquiry pre-screening** | Move-in date, unit and the manager's own lawful questions; takes showing requests; never accepts or rejects | 2 |
| **Intake (minimal)** | Contact + topic category only for professional packs — no case/health details (§5) | 3 |
| **Clinic booking integrations** | Jane App, Cliniko, Dentrix — depends on API access (§17) | 3 |
| **Document chaser** | Reminders for missing checklist items; secure upload page; vision check that a file is legible and the right form before staff are alerted | 3 |
| **Catalog feeds** | Structured feeds (CSV, Shopify, Square) into services & products; later vehicles and listings | 3 |
| **Careers & recruiting** | Job Q&A, application link | 4 |
| **Internal knowledge** | Staff-only assistant over private docs, SSO, permissions | 4 |

**Phone and SMS — later phase** (§7.3; order: SMS, then voice)

| Module | What it does | Step |
|---|---|---|
| **Missed-call text-back** | Texts the caller within seconds of a missed call, with a link to the business page; the conversation continues by SMS | SMS |
| **Two-way SMS + photos** | The same assistant by text; photos by MMS attached to the request | SMS |
| **Owner alerts by text** | Urgent requests and summaries texted to the owner or on-call person | SMS |
| **Reminders & confirmations** | Transactional texts: booking confirmation, reminder, "on our way" | SMS |
| **Status & pickup alerts** | "Is my car ready?" answered from the shop software; pickup text with a payment link | SMS |
| **Phone answering** | AI voice agent on the business's local number: greeting with the recording disclosure, answers, takes the details, transfers to a person | Voice |
| **Emergency transfer & on-call dispatch** | Urgent calls transferred live; repeat calls down the on-call list | Voice |
| **Call summaries** | Recording, transcript and summary for each call | Voice |
| **Waitlist backfill & recall** | Offers cancelled slots to the waitlist; recall campaigns to clients who consented (clinics) | SMS |

**Self-serve local-business modules** (built on demand, not on the early-stage path): reservations &
ordering, menu (vision OCR), age gate, events & tickets, donations & volunteering.

### 4.3 Pack catalog by phase (Northern Ontario research counts in brackets)

| Phase | Sector | Packs → variants | Key modules | Notes |
|---|---|---|---|---|
| **1 — first pilots** | Home & Construction | **Trades & home services** → plumbing, HVAC, electrical, roofing, landscaping / snow removal, cleaning | Business page with services, area and past work; urgent request flag, quote request + photos, service-area check, booking link. Later: phone and SMS | Gas smell, carbon monoxide, no heat in winter, flooding → urgent. No diagnosis, no binding prices |
| **1 — first pilots** | Automotive (local) | **Auto repair & tire shop** → general repair, tire centre, body/collision, glass, oil change, detailing | Business page with services and the price list; tire changeover and repair requests, booking link; Phase 2: seasonal scripts. Later: phone and SMS, status & pickup alerts | "Estimate after inspection" |
| **1** | Generic | Fallback for anything else | Lead capture, handoff, hours | |
| **2** | Property | **Property management & rentals** (new pack) → residential property manager, student housing, condo management | Business page with available units; maintenance requests, urgent request flag, rental inquiry pre-screening, showing requests | No tenancy-law advice; collects answers only, never accepts or rejects an applicant |
| **2** | Professional & business services (non-regulated) | **Business services** [21] → marketing agency, IT/web, photography, printing, event planning, security, cleaning | Quote request, booking | Customer service + quotes |
| **3** | Health & Wellness | **Clinic** [25] → vet, medspa/aesthetics, dental, physio/chiro, vision & hearing, counselling · **Pharmacy** [2] | Business page with services, team and fees; booking integrations, minimal intake. Later: reminders, waitlist backfill & recall | **Customer service only** (§5); PHIPA + Canada data residency first; vet variant first |
| **3** | Legal & Financial | **Accounting & tax** [5] · **Law firm** [21] (real-estate law first) · **Immigration consultant** · **Insurance broker** [2] · **Credit union / advisory** [3] | Business page with services, fees and what to bring; minimal intake, document chaser | **Customer service only** (§5) |
| **3** | Real Estate | **Brokerage / agent** [5] | Listings feed, showing booking, inquiry pre-screening | No valuations or legal/financial guidance |
| **3** | Automotive (sales) | **Car dealership** [8] → new & used cars, used-car lot, powersports/RV/boat | Vehicle inventory feed, test-drive & service booking, Marketplace inquiry screening, trade-in and financing _inquiry_ forms | No final prices, trade-in values or financing terms |
| **Self-serve (built)** | Food & Drink, Retail, Personal care, Hospitality & Tourism | **Restaurant & bar** [86] · **Café & bakery** [22] · **Retail store** [71] · **Salon, spa & barber** [16] · **Tattoo & piercing** [6] · **Lodging** [18] · **Attractions, tours & recreation** [22] | Web chat: hours, notices, booking links, menu, age gate | Stay selectable at signup; no outbound sales |
| **Self-serve (on demand)** | Food & Drink, Arts, Fitness, Education, Community | **Grocery & market** [12] · **Brewery & producer** [11] · **Arts, culture & events** [27] · **Gym & studio** [~6] · **Tutoring, language, driving & music schools** · **Non-profit & settlement services** [8] | Web chat: catalog, events & tickets, donations, multilingual | Released when customers ask |
| **4** | Industrial & Institutions | **Mining supply & services** [17], **Engineering** [5], **Manufacturing** [4], **Auto manufacturer & parts maker** [0], **Transportation** [7], **Utilities** [6], **Colleges** [7] | RFQ, careers, internal knowledge; for auto makers: dealer/distributor locator, product specs, warranty & recall lookup | Business tier; enterprise sales |

**Early-stage packs:** Trades & home services and Auto repair & tire shop (Phase 1), Property management &
rentals (Phase 2), Clinic and the professional packs (Phase 3).

**Catalog in code:** `packages/industry-packs` follows this table. A pack has one phase number and the
operator releases phases in order (`releasedPackPhase`), so the on-demand self-serve packs sit in phase 2
and become selectable together with Property management. Trades and Auto repair have their own templates
and workflow libraries; packs without a template use the generic one until theirs is written.

## 5. Scope policy — customer service, not professional advice

A **platform-wide, locked rule**: every bot is a customer-service assistant for the business. This matters
most for professional packs (Phase 3: clinics, pharmacy, law, accounting, insurance, financial, real estate,
immigration) but applies everywhere (e.g. restaurants: no medical advice about allergies).

| The bot **does** (customer service)                                                      | The bot **does not** (professional advice)                                                            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Services offered, team members and their **languages spoken**                            | Legal, medical, dental, tax, financial, insurance, immigration or engineering advice                  |
| Hours, location, parking, accessibility                                                  | Assess a situation ("do I have a case?", "is this serious?", "am I eligible?")                        |
| Published fees and pricing structure, payment options, insurance/direct billing accepted | Interpret laws, regulations, policies, contracts, test results                                        |
| What happens at a first appointment/consultation, what documents to bring                | Predict outcomes, chances, timelines, amounts                                                         |
| How to book, reschedule, cancel; forms and links                                         | Recommend treatments, medications, investments, products for a personal situation                     |
| General info _published by the business_ on its own site                                 | Collect sensitive details (health conditions, case facts, SIN, immigration status, financial details) |

**What the rule means in the early-stage industries**

| Industry | The assistant does | The assistant does not |
|---|---|---|
| Trades & home services | Take the details and photos, give price ranges from the business's own price rules, book or escalate | Diagnose the fault; promise a price or arrival time the business hasn't set; give repair steps for gas, electrical or structural work |
| Auto repair & tire shops | Quote tire and service packages from the shop's list, book a bay, report job status from the shop system | Diagnose from a description; say a car is safe to drive; give a binding repair price |
| Property management | Log maintenance requests, escalate emergencies, record applicants' answers, book showings | Decide on an application; give tenancy-law advice (rent increases, evictions, deposits); ask more than the manager may lawfully ask |
| Clinics | Book, reschedule, remind, answer from published information | Discuss symptoms, treatment or results; take health details by phone or text |
| Accounting, legal, immigration | Reception, file status as recorded by staff, reminders about missing documents | Advise on tax, law or eligibility; accept documents or SINs by SMS/MMS |

**Emergencies, on every channel:** danger to life or property (gas smell, carbon monoxide alarm, fire,
electrical hazard) → tell the customer to leave and call 911 or the gas utility first, then show the
business's phone number and alert the owner. The assistant can't call emergency services for anyone and
says so.

**On every call (later phase):** the greeting says this is an automated assistant on a recorded line, and the caller can
always ask for a person (transfer during opening hours, callback request otherwise).

**Standard response when advice is requested:** acknowledge → explain the assistant can't give advice → offer
to book a consultation / request a callback → urgent resources when relevant (911, 9-8-8) → capture name,
contact, preferred language and a **topic from a fixed list** only.

**Enforcement layers**

1. **Locked platform rule** in the system prompt, placed above pack and tenant instructions; tenant custom
   instructions cannot loosen it (admin UI rejects/flags instructions like "give legal opinions").
2. **Scope classifier** on every message (cheap model + keyword rules, all languages) tags advice-seeking
   questions → the engine switches to the deflection template + booking offer.
3. **Output check** for professional packs: a second cheap pass flags answers that look like advice before
   they are sent (replace with the safe template).
4. **Minimal intake:** no free-text case descriptions; notice "please don't share confidential details here".
5. **Widget disclaimer** for professional packs ("This assistant provides information about [business], not
   professional advice"), translated into all supported languages.
6. **Evals:** adversarial advice-seeking cases in every Tier 1–2 language; a professional pack ships only at
   100 % pass on these.
7. **Contracts:** Terms of Service — the platform provides no professional advice; the client is responsible
   for its published content. Get a lawyer to review before Phase 3.

## 6. Multilingual support

**By channel:** the chat page and the widget answer in the customer's language from day 1, as built; SMS
will do the same. **Voice (later phase) starts in English, then French**; another language is added to voice only after its speech
recognition and speech quality pass a test with native speakers. Bilingual EN/FR phone answering with
automatic detection is a selling point where French is common (Eastern and Northern Ontario, New Brunswick,
Quebec border towns) and can be sold as an upgrade.

### 6.1 Language tiers

| Tier                                     | Languages                                                                                                                                   | What's supported                                                                                                             | Phase                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Tier 1 — full**                        | English, French                                                                                                                             | Widget + admin UI, pack templates and safety messages reviewed by humans, eval sets                                          | 1                                     |
| **Tier 2 — priority newcomer languages** | Chinese (Simplified & Traditional), Hindi, Punjabi, Urdu, Arabic, Persian (Farsi), Ukrainian, Tagalog, Spanish                              | Visitor answers, widget UI strings, safety messages & disclaimers reviewed by native speakers, eval sets, RTL tested         | 1 (answers) → 2 (reviewed UI & evals) |
| **Tier 3 — best effort**                 | Any other language the model handles well: Gujarati, Tamil, Telugu, Malayalam, Bengali, Russian, Turkish, Vietnamese, Korean, Portuguese, … | Answers in the visitor's language, UI falls back to English, note "automatic translation — please confirm important details" | 1                                     |
| **Owner-provided**                       | Indigenous languages (Anishinaabemowin/Ojibwe, Oji-Cree, Cree) and low-resource languages                                                   | Greeting/key phrases supplied by the business or community partners, then route to a human                                   | 2                                     |

Tier lists are configuration, not code — promote a language when customer demand appears.

### 6.2 Implementation — the LLM does all translation

No separate translation service at launch: the LLM (through the gateway, §9) handles every translation task.

| Approach                                    | How it works                                                                                                               | Use it for                                                              | Phase         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------- |
| **A. Model-native answers** (default)       | Detect language → multilingual embeddings retrieve from EN/FR content → LLM answers in the visitor's language              | All tiers                                                               | 1             |
| **B. Query translation for retrieval**      | Cheap model translates the question into the knowledge-base language before search; answer still in the visitor's language | Non-EN/FR questions                                                     | 1             |
| **C. Inbox translation**                    | Cheap model translates visitor messages into the owner's language (original kept alongside)                                | Owner inbox, leads, handoff alerts                                      | 2             |
| **D. Pre-translated key facts**             | LLM translates Q&A pairs, notices, menu, hours, greeting into enabled languages at ingestion; owner can review/edit        | Paid plans                                                              | 2             |
| **E. Human review**                         | Native speakers review platform safety messages, disclaimers and UI strings; owners edit their own content                 | Tier 1–2 languages                                                      | 1–2           |
| _F. Dedicated translation service (future)_ | _DeepL, Google Cloud Translation, Azure AI Translator, Amazon Translate, or certified human translation_                   | _Only if legal/medical-grade or certified translation is ever required_ | _Not planned_ |

To keep F possible without rework, translation calls go through one small internal function
(`translate(texts, to)`) implemented with the LLM — no extra vendor, interface or table at launch.
Glossaries (dish names, brand names) are handled by passing "do not translate" terms in the prompt.

### 6.3 Owner side

- **Inbox auto-translation:** each visitor message shown in the owner's language with the original alongside
- Leads and handoff alerts include the visitor's **preferred language** and a translated summary
- Owner sets "languages our staff speak" → the bot mentions it ("we have Punjabi-speaking staff")
- Admin portal UI: English and French first; add Chinese, Hindi/Punjabi, Arabic, Ukrainian if owners ask —
  many business owners are newcomers themselves

### 6.4 Technical requirements

- Unicode everywhere; language detection per message (visitor can switch language manually)
- **Right-to-left** layout for Arabic, Urdu, Persian (`dir="rtl"`, mirrored widget, bidirectional text)
- **Fonts:** system font stack with Noto fallbacks for CJK, Devanagari, Gurmukhi, Arabic scripts
- **IME support:** don't send on Enter while a Chinese/Hindi input method is composing (`compositionstart/end`)
- **Search:** Postgres full-text doesn't segment Chinese and weakly handles Indic scripts → rely on vector
  search + `pg_trgm`/bigram matching for those; English/French `tsvector` configs for EN/FR
- **Embeddings:** must be strongly multilingual (cross-lingual retrieval); evaluate on Tier 2 languages
- **Locale formatting:** dates, times, currency via `Intl` APIs
- **Cost:** non-Latin scripts often use more tokens per message — meter cost per language
- **Voice:** EN, then FR; speech-to-text/text-to-speech coverage checked per language before it is offered
  (e.g. Mandarin vs Cantonese, Punjabi)
- **Evals:** 30–50 questions per launch pack per Tier 2 language, sampled native-speaker review

## 7. Feature scope

### 7.1 AI business page — the first product

The hosted chat page (`/c/<public-key>`, built) grows into the business's public page: a page a customer
can read, with an assistant they can ask. It replaces the website a small business doesn't have or doesn't
maintain. It is **one designed page, not a website builder**: the layout is fixed and the owner fills it in.

| Part of the page | What it shows | Status |
|---|---|---|
| **Header** | Name, logo or photo, one-line description, open or closed now, town or service area | Built |
| **Contact buttons** | Call, email, directions, book, shop | Built |
| **Assistant** | The chat, front and centre, with suggested questions | Built |
| **Services & products** | Cards: name, short description, photo, price text ("from $120", "call for a quote"), category. "Ask about this" opens the chat on that item; "Request a quote" or "Book" starts the matching workflow | Built |
| **Photos** | Gallery of the business's photos (past work, storefront, team) | Built (the knowledge photos shown in answers, up to 12) |
| **Hours, area, notices** | Opening hours, service area, time-limited notices | Built |
| **Footer** | Address, licences and insurance if given, languages spoken, privacy note, "Powered by" | Built |

Built as: the API renders the page into the chat app's HTML (`apps/api/src/page/`), the chat app mounts
in it; friendly link `<chat-domain>/<slug>` (path form chosen for now, open decision §17.3 can still
move it to a subdomain); `catalog_items` and `notices` tables (RLS). `robots.txt` and a sitemap of the listed
pages. Not yet: page text in Tier 2 languages (page is EN or FR by the default language). Page statistics (1.5): daily
views and contact-button taps in `page_stats` (RLS, totals only), shown with questions and requests on
the admin's Business page tab.

**Two presets of the same page**

- **Business page** — logo, team, one or more locations.
- **Personal page** — one person: photo, trade or profession, areas served. For independent contractors
  and other solo professionals.

**From nothing to a live page**

1. **Sources, any mix:** an old website; a price list or brochure (PDF or photo); photos from the owner's
   phone; text pasted from a Facebook page; Google Business Profile details (§17); or a **short interview**
   in which the setup assistant asks the owner a handful of questions and saves the answers as knowledge.
2. **The setup assistant proposes** the business details, the description, the services or products with
   the prices found in the sources, a greeting, suggested questions, and the facts customers will ask for
   that are still missing. As today, nothing is proposed that isn't in the sources or typed by the owner.
3. **Review and publish** — by the owner, or by us in the done-for-you setup.
4. **Share:** a friendly link (the business's name instead of a key), the QR code, the "website" field of the
   Google Business Profile, social profiles, invoices, vehicles. Phase 2: the business's own domain.

**Rules for the page**

- **It works without chatting.** Services, prices, hours, area and contact details are ordinary page
  content, for the customer who only wants the phone number and for search engines.
- **It can be found.** The content is in the page's HTML when it loads, with a title, a description and
  local-business structured data. Only published pages are listed; an owner can keep a page unlisted.
- **Limited design on purpose.** Templates and brand colour from Appearance (§7.2); no custom pages, CSS
  or HTML, so every page stays fast, accessible (WCAG 2.1 AA) and mobile-friendly.
- **One assistant everywhere.** The page, the inline iframe and the widget share the knowledge, the
  services list and the conversation log. A business with a good website uses the widget and can ignore
  the page.
- **Nothing invented.** Prices, stock and availability come only from what the owner entered.

### 7.2 Chat surfaces: hosted page, iframe embed, widget

One chat web app (`apps/chat`) powers every surface. Customers pick what fits their site:

| Surface | How the customer uses it | Good for |
|---|---|---|
| **Web version** (hosted chat page) | Opt-in per assistant ("Activate web version"). A link `https://<chat-domain>/c/<public-key>` plus a **QR code generated in the admin** (PNG/SVG download) — full-page chat with the business's branding; share it anywhere (business cards, flyers, invoices, vehicles, tables, Google Business profile, social media) | **Independent contractors and other businesses without a website**; restaurants/lodging table and door QR codes |
| **Inline iframe** | `<iframe src="https://<chat-domain>/c/<public-key>?embed=inline">` placed inside one of their pages (e.g. a "Ask us" page) | Customers who want a full chat page inside their own site |
| **Floating widget** | `<script src="https://<chat-domain>/widget.js" data-bot="<public-key>" async></script>` — a small loader adds a launcher button that opens the same chat page in an iframe panel | Every page of their site |

- **Isolation:** all three use the chat page; the widget and inline embed are iframes, so the customer's CSS
  and scripts can't break the chat (and vice versa). Loader script < 5 KB; chat page loads on first open.
- **Who may embed:** the chat page is served with `Content-Security-Policy: frame-ancestors` built from the
  bot's allowed origins — only the business's own sites can iframe it. The web version is off until the owner
  activates it (at creation — "I don't have a website" — or later in Share & install); when off, the link and
  QR code show a "not available" page while website embeds keep working.
- **Same features everywhere:** the web version is the same assistant, knowledge and conversation log as the
  widget; there is no separate "contractor" product.
- **Same origin as the API:** the chat page and its API calls share one origin, so no CORS and no third-party cookies.
- Streaming, sanitized markdown, sources, quick replies, lead/quote cards, image upload (Phase 2), human handoff
- **Language switcher**, auto-detect, RTL, CJK/Indic fonts, IME-safe input
- **WCAG 2.1 AA** (covers Ontario AODA)
- **Settings are split in two tabs**, both applying to the web version, iframe and widget at once without
  changing the install code: **General** (names, languages, and the texts visitors see) and **Appearance**
  (visual design only, with a live preview).
- **General:** assistant name shown to visitors and the name in the dashboard; **languages** — the owner turns
  on the languages their customers use (grouped as full support, newcomer languages with translated chat
  buttons, and more languages with translated answers), picks the default language, and chooses whether the
  assistant also answers visitors writing in other languages (on by default; when off, those visitors get
  answers in the default language); greeting and suggested questions per enabled language; launcher button
  text. Texts for a language that's turned off are kept for when it's turned back on.
- **Appearance — customizable, but limited:**
  - *Limited:* one of 5 designed templates — Classic, Minimal, Friendly, Bold, Midnight (dark) — plus a brand
    color: 12 ready-made colors (Forest, Teal, Lake blue, Navy, Purple, Plum, Raspberry, Red, Orange, Gold,
    Coffee, Charcoal) or, for advanced users, a custom color (picker or hex code). Text and link colors are
    derived automatically so any color stays readable (WCAG contrast).
    No custom CSS/HTML, so every chat stays accessible, mobile-friendly and consistent.
  - *Fully customizable:* picture (uploaded photo/logo — cropped to a square, PNG/JPEG/WebP checked by content,
    SVG refused — or a built-in icon, or initials) and the launcher button's side. (Name, greeting, suggested
    questions — up to 6 per language, industry suggestions by default, can be hidden — and launcher text are in
    General.)
  - Later: hide "Powered by" on paid plans; more templates based on customer demand
- Later: friendly short links (e.g. `/<business-name>`) that survive key rotation, QR scan analytics,
  printable QR flyer templates, WordPress plugin, Shopify app, Wix/Squarespace/Webflow guides

### 7.3 Phone and SMS — later phase

Starts after the paid launch, when pilots ask for it (§14). SMS comes first and sends customers to the
business page; voice follows. The same assistant, knowledge and services list answer on every channel.

**Number and forwarding.** Each business gets a local number in its own area code (519, 613, 705, 905, 250,
902 …). It keeps its public number and forwards the calls it doesn't answer (no answer, busy, after hours)
to the assistant's number; some will forward every call. Forwarding codes differ by carrier and by
landline, mobile or VoIP line, so setup uses a per-carrier sheet and ends with a test call.

| Flow | What happens |
|---|---|
| **Missed-call text-back** | A forwarded call isn't completed (the caller hangs up, or the business chose text-back only) → a text within seconds: "Sorry we missed you — this is [Business]'s assistant. What do you need help with?" → the conversation continues by SMS |
| **Inbound call** | Greeting with the disclosure → understand the request → answer from the business's information → triage → collect name, address or postal code and the problem (photos by a follow-up text) → book, or take a request → summary to the owner |
| **Emergency** | Urgent rules match → safety message → live transfer to the owner or on-call number; if nobody answers, an urgent text and repeat calls down the on-call list |
| **Inbound SMS / MMS** | The same assistant by text; photos attached to the request |
| **Outbound texts** | Replies and transactional messages only: confirmations, reminders, status, missed-call follow-up; STOP handled automatically. No cold outbound texts and no AI sales calls (§12) |

**On a call**

- Greeting (EN/FR): "Thanks for calling [Business]. I'm the automated assistant, on a recorded line — how
  can I help?"
- Short spoken answers; names, phone numbers and addresses are read back to confirm; the caller can interrupt.
- "Talk to a person" always works: transfer during opening hours, callback request otherwise.
- Limits per business: maximum call length, simultaneous calls (by plan), daily spend cap.
- Target: the reply starts within about one second.

**For the owner**

- After each call: a text or email summary (who, what, how urgent, booked or not) with a link to the
  recording and transcript.
- In the portal: calls and SMS threads in Conversations; requests with the caller's number and photos;
  phone settings (number, hours, on-call list, transfer rules, greeting).
- An owner who never opens the portal still gets everything by text or email and in Jobber or the calendar.

### 7.4 Client admin portal (EN/FR first)

1. **Onboarding wizard:** sector → pack → variant → website URL, or "I don't have a website" (interview,
   price list, photos — §7.1) → confirm business profile (hours, phone, booking links, **staff
   languages**) and the services list → choose bot languages → preview the page → publish, share link, QR
   code, embed code
2. **Business page:** services & products editor (cards, photos, price text, order), page details, business
   or personal preset, preview, publish or keep unlisted, friendly link
3. **Knowledge base:** pages, PDF/DOCX, price lists and menu images, Q&A pairs, notes, feeds (Phase 3);
   per-language versions; **Q&A pairs override everything**
4. **Notices** with start/end dates, auto-translated
5. **Playground:** test in any language; "fix this answer" → Q&A pair
6. **Bot settings:** persona, greeting, languages, hours & seasons, modules, lead fields, handoff contacts,
   custom instructions (scope-checked, §5)
7. **Inbox** (auto-translated), **Leads**, **Analytics** (page visits, questions, requests, languages used,
   knowledge gaps)
8. **Install**, **Team & roles**, **Billing & usage** (CAD)

### 7.5 Operator console

- **Delivered (`/operator` in the admin app):** overview (businesses, assistants, questions,
  refusals, AI cost this month); businesses (search, change plan, suspend/reactivate, usage and cost, members
  and assistants); all users and their businesses; plans (create, edit allowances and prices, archive);
  platform policies (default plan for new businesses, released industry phase, per-visitor/per-conversation/
  per-IP limits); audit trail of every change. Plans and policies live in the database and apply within 30
  seconds.
- **Super admin role, staff accounts only:** a platform role on dedicated Traiblazer accounts that can never
  belong to a business (enforced in the database), granted only from the command line
  (`pnpm --filter @traiblazer/api superadmin grant <email>`), never through the API. Business users can't
  reach the console (404) and never see it.
- **Support access:** super admins can open any business's assistants and usage pages and change settings as
  an admin, with a "Support mode" banner; every change is written to the business's own audit log and the
  operator audit log.
- Later: a support role with narrower rights (view-only or no plan/policy changes), and showing the business
  its activity log in the admin portal
- Packs/variants/modules (versioned) with eval results per language
- **Prospect demo generator (built):** build a private demo page and assistant from a prospect's
  public information (website, text pasted from its Google listing or Facebook page) to show at the
  first contact (§2.2). The console's Demos tab fills the page in with the setup assistant, shows a
  demo notice on it, keeps it out of search engines, counts views, chats and requests, and hands the
  business over to the owner's account when they sign up. Google listing import still waits on §17.4
- **Done-for-you onboarding checklist (built):** the Onboarding tab, one checklist per business: sources
  read, page content, services list, photos, owner review, link on the Google listing, go-live. The first
  five and go-live are checked from the business's data; staff tick the owner's review and the Google
  link, and publish the page from the checklist once the owner approved it. Due one working day after the
  materials arrived (§14), with "due in / overdue / live on time" on each card
- System health: ingestion queue, errors, latency, provider fallbacks, scope-classifier triggers

## 8. Architecture

The phone and SMS parts (the top of the diagram, `apps/voice`, telephony) and the integrations belong to
later phases; the rest exists today.

```
 Caller ──► business's number ──(forward missed / after-hours calls)──► Telephony provider (Twilio / Telnyx)
                                                                          │ audio          │ SMS/MMS and
                                                                          ▼                │ call-status webhooks
                                                    Voice orchestrator (speech ↔ text,     │
                                                    turn-taking; managed first)            │
                                                                          │                │
                                                                          ▼                │
                                                    ┌──────────────────────────┐           │
                                                    │ Voice service (apps/voice)│           │
                                                    │ live calls only           │           │
                                                    └────────────┬─────────────┘           │
 Visitor's browser ──► chat page / iframe / widget ─┐            │ same engine             │
 Business owner  ──► Admin portal (Next.js) ────────┤            │ (packages/core)         │
                                                    ▼            ▼                         ▼
                      ┌───────────────────────────────────────────────────────────────────────┐      ┌─────────────────────┐
                      │ API service (stateless)                                               │─────►│ LLM gateway          │──► Anthropic / Bedrock / Azure
                      │ - conversation engine (web, SMS)     - telephony webhooks (signed)    │      │ chat + translation,  │    Foundry / Vertex / OpenRouter /
                      │ - scope guard, language layer        - admin REST API, auth, quotas   │      │ routing, fallbacks,  │    OpenAI / Gemini / self-hosted
                      └───┬──────────┬───────────┬────────────────────────────────────────────┘      │ metering             │
                          ▼          ▼           ▼ enqueue jobs                                      └─────────────────────┘
                   PostgreSQL     Redis      Queue ──► Worker(s): crawl → parse/OCR → chunk → embed → index;
                   + pgvector   (rate limit,           outbound texts (text-back, reminders, alerts) with retries;
                   (RLS)         cache)                integration sync; pre-translation; analytics
                          ▲                                   │
                          └── Object storage (S3/R2) —        └──► Integrations: Jobber, Housecall Pro, Google Calendar,
                              uploads, photos, call recordings     Stripe, later Jane App and shop software
```

### 8.1 Recommended stack (TypeScript end-to-end)

| Layer             | Choice                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo          | pnpm + Turborepo                                                                                                                               |
| Admin portal      | Next.js + Tailwind + shadcn/ui + i18n (ICU messages, RTL-ready)                                                                                |
| Chat page + widget | Preact + Vite: one chat page (hosted link / iframe) + a tiny `widget.js` loader, served by the API with per-bot `frame-ancestors`              |
| Business page     | The API serves the page with the business's content (details, services, hours, notices) already in the HTML, plus structured data; the Preact chat starts on top of it |
| API               | Fastify (Node), SSE streaming, OpenAPI                                                                                                         |
| Workers           | Postgres-backed job queue (`FOR UPDATE SKIP LOCKED`) in a worker process; move to BullMQ/SQS if volume requires                               |
| DB                | PostgreSQL 17 + pgvector + full-text (EN/FR) + `pg_trgm`                                                                                       |
| ORM               | Drizzle                                                                                                                                        |
| Auth              | Own email/password + session-cookie auth with tenant memberships (built in Phase 0); password reset & email verification in Phase 1; SSO later |
| Billing           | Stripe (CAD, Canadian sales tax)                                                                                                               |
| LLM               | Own `LLMProvider` interface; Claude adapter (official Anthropic SDK) + OpenAI-compatible adapter (OpenRouter etc.) + offline test provider (§9) |
| Translation       | The LLM via the gateway (cheap model); no separate service                                                                                     |
| Embeddings        | `EmbeddingProvider` interface; strongly multilingual model (Voyage AI, Cohere, OpenAI, Bedrock, Azure, Gemini, local)                          |
| Parsing           | Readability/Cheerio, `unpdf`/`mammoth`, vision-model OCR for menus, Playwright for JS-heavy sites                                              |
| Storage / hosting | S3 or R2; Vercel (admin) + Fly.io / Render / AWS ECS (API + workers) + Cloudflare CDN/WAF; Canadian region available for later residency needs |
| Telephony (later) | Twilio or Telnyx behind a `TelephonyProvider` interface: local Canadian numbers, SMS/MMS, call events, signed webhooks |
| Voice (later)     | Managed orchestrator (Vapi or Retell) with our engine as its model; own pipeline (provider media streams + streaming speech-to-text / text-to-speech) only if cost or control require it |
| Integrations (Phase 2 on) | Direct connectors in `packages/integrations`: Google Calendar and Jobber first, then Housecall Pro, Stripe payment links, QuickBooks Online (Canadian edition); OAuth tokens encrypted per tenant. Make or n8n is acceptable for a one-off pilot connection |
| Observability     | Sentry, OpenTelemetry, per-message usage & cost in DB                                                                                          |

> Alternative: Python (FastAPI) backend (LiteLLM for the gateway); chat page and admin stay TypeScript.

### 8.2 Monorepo layout

```
traiblazer/
  apps/
    admin/            Next.js admin portal                                   (built)
    api/              Fastify API, chat page + widget.js, telephony webhooks (built; webhooks later)
    chat/             Preact chat page / business page + widget loader       (built; page Phase 1)
    worker/           background jobs, outbound texts                        (built; texts later)
    voice/            live phone calls                                       (later)
  packages/
    core/             conversation engine, tools, retrieval, prompt builder, crawler, job queue
    llm/              LLM gateway (incl. translate helper), embeddings
    db/               schema, migrations, RLS
    addons/           add-on contract, registry, built-in add-ons
    appearance/       chat templates and brand colours
    i18n/             UI strings (ICU), language registry & tiers, RTL helpers
    industry-packs/   sectors/packs/variants + templates (guidelines, workflows, triage rules)
    shared/           Zod schemas shared by API and admin
    telephony/        provider interface (Twilio / Telnyx): numbers, SMS/MMS, call events,
                      webhook signature checks, number → assistant lookup            (later)
    integrations/     connectors: Google Calendar, Jobber, Housecall Pro, Stripe, …  (Phase 2)
    scope-guard/      advice classifier, output check, safe templates                (Phase 1–3)
  infra/  evals/ (per pack × language × channel)  docs/
```

### 8.3 Where phone and SMS will run (later phase)

Everything stays in **this monorepo**. Phone and SMS reuse the engine, the tenant model (RLS), the limits,
the metering and the admin portal; a second repository would duplicate all of that.

| Part | Where it runs | Why |
|---|---|---|
| **SMS / MMS in and out, missed-call text-back** | No new app. Webhook routes in `apps/api` (one Fastify plugin), sending in `apps/worker`, provider code in `packages/telephony` | An inbound text is one short, stateless request: verify the signature, find the assistant by the number, run the engine with `channel: "sms"`, queue the reply. Sending is a job, so retries, rate limits and scheduled reminders reuse the existing queue |
| **Live phone calls** | A separate deployable, `apps/voice`, in the same monorepo | A call is a long-lived, latency-critical stream. It must survive an API deploy, scale with the number of simultaneous calls (winter-tire season), run close to the carrier, and drain calls before shutting down. A crash or slow admin request in the API must never cut a call |
| **Shared logic** | `packages/core`, `packages/telephony`, `packages/integrations` | `apps/voice` and `apps/api` stay thin: both call the same engine and tools, so an answer, a booking or a triage rule behaves the same on a call, in a text and in web chat |

**Order of work**

1. **SMS first.** Missed-call text-back needs no voice AI: the forwarded call hits the provider number, the
   call-status webhook queues a text, and the SMS conversation runs on the existing engine. It can be sold
   on its own.
2. **Voice on a managed orchestrator** (Vapi or Retell). The orchestrator handles audio, speech-to-text,
   text-to-speech and interruptions; `apps/voice` exposes the engine to it as the "brain" and serves its
   tool calls. Our knowledge, scope rules, tools and metering stay ours.
3. **Own audio pipeline only if cost or control require it** (provider media streams + streaming
   speech-to-text and text-to-speech). `apps/voice` is where that code goes; nothing else moves.

**What the engine needs for these channels**

- `sms` and `voice` added to the channel list; replies shaped per channel (SMS: short plain text, links
  allowed; voice: short spoken sentences, no markdown, numbers and addresses said aloud).
- A **fast model profile for voice** (Haiku-class or another low-latency model). The default answer model
  thinks before replying, which is too slow for a live call (§9.2).
- Tools that take time (calendar lookup) say so first ("one moment while I check the schedule").
- The caller is identified by phone number instead of a browser visitor ID; limits apply per number.
- Any failure on a call falls back to voicemail plus a text-back, never to silence.

## 9. Conversation pipeline

1. **Ingress:** `POST /v1/chat` (SSE). Validate key, origin allowlist, rate limits, quota.
2. **Load config** (bot, pack/variant, modules, profile, notices), cached.
3. **Language layer:** detect language (or use visitor's choice); pick tier behavior (§6.1).
4. **Scope guard:** classify the message (advice-seeking? emergency? abuse/prompt injection?) → safe template,
   escalation, or continue.
5. **Retrieve:** stand-alone query rewrite + translation into KB language (§6.2 B) → hybrid search
   (vector + full-text/trigram, RRF), tenant/bot-filtered; Q&A pairs and pre-translated facts boosted;
   catalog lookup tool for structured questions.
6. **Build prompt** (stable first for caching): locked platform & scope rules → pack/variant → modules →
   business profile → tenant instructions → _(cache boundary)_ → notices → retrieved context (untrusted data)
   → history → question + "answer in <language>".
7. **Call the LLM gateway** (streaming) with module tools (`capture_lead`, `request_handoff`,
   `search_catalog`, …), executed server-side with tenant validation.
8. **Output check** (professional packs), citations, sanitize; "couldn't answer" → knowledge gap + lead/handoff.
9. **Persist & meter** (tokens incl. translation calls, cost, language).

### 9.1 Multi-provider LLM gateway

```ts
interface LLMProvider {
  id: string; // "anthropic", "bedrock", "azure_foundry", ...
  chat(req: ChatRequest): AsyncIterable<ChatEvent>; // text, tool calls, usage, stop reason
  capabilities(model: string): ModelCapabilities; // tools, vision, caching, context, regions, languages
}
interface EmbeddingProvider {
  embed(texts: string[], opts): Promise<number[][]>;
  model: string;
  dims: number;
}
```

| Provider                               | Gives you                            | Notes                                        |
| -------------------------------------- | ------------------------------------ | -------------------------------------------- |
| **Anthropic API**                      | Claude models, newest features first | Prompt caching, citations, refusal fallbacks |
| **OpenRouter**                         | Hundreds of models, one key          | "Any model", evals, cheap tiers              |
| **AWS Bedrock**                        | Claude, Llama, Mistral, Nova, Cohere | AWS credits, IAM, regional hosting           |
| **Microsoft (Azure) Foundry**          | GPT, Claude, Llama, Mistral, Phi     | Microsoft clients, Canadian regions          |
| **Google Vertex AI / Gemini**          | Gemini, Claude on Vertex             | GCP clients                                  |
| **OpenAI API**                         | GPT + embeddings                     |                                              |
| **Mistral, Groq, Together, DeepSeek…** | Price/speed                          | OpenAI-compatible adapter                    |
| **Self-hosted (Ollama, vLLM)**         | Private models                       | OpenAI-compatible adapter                    |

Gateway: normalize messages/tools/streams/usage; cost from `model_catalog`; routing profiles with ordered
fallbacks (429/5xx/timeouts/refusals); capability checks (vision for menus/images); provider-specific extras
capability-flagged; platform keys or BYOK; per-provider rate limits & circuit breakers; **evals per model ×
language** so model choice per plan is measured (language quality differs between models).
Implementation: own interfaces with two adapters that cover most providers — **Claude** through the official
Anthropic SDK (direct API now; its Bedrock/Vertex/Foundry clients later) and an **OpenAI-compatible** adapter
(OpenRouter, OpenAI, Azure OpenAI, Groq, Mistral, Ollama, vLLM). An offline test provider runs without keys.

### 9.2 Model selection and cost (example: Claude via Anthropic API, per 1M tokens)

| Model             | ID                  | Input / Output | Fits                                                     |
| ----------------- | ------------------- | -------------- | -------------------------------------------------------- |
| Claude Opus 5.5   | `claude-opus-5-5`   | $4 / $20       | Highest quality; default                                 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | $2 / $10       | Strong quality, half the price                           |
| Claude Haiku 5.5  | `claude-haiku-5-5`  | $0.10 / $0.50  | Query rewrite/translation, scope classifier, simple bots |

Rough cost per reply (≈4K input, ≈400 output, USD, before caching): Opus 5.5 ≈ $0.024 · Sonnet 5.5 ≈ $0.012 ·
Haiku 5.5 ≈ $0.0006 — i.e. ≈ $24 / $12 / $0.60 per 1,000 replies; non-Latin scripts cost more.
Default profile uses `claude-opus-5-5`; profiles are per plan and per bot — decide the Local plan's profile
after EN/FR + Tier 2 evals. Cheap model for auxiliary steps (rewrite, translation, scope classifier).
**Live calls use a separate fast profile** (Haiku 5.5 or another low-latency model): thinking on Opus 5.5
can't be disabled, so it is too slow for a spoken reply.

Claude adapter notes: `output_config.effort` (`low` for chat); thinking on Opus 5.5 can't be disabled; forced
`tool_choice` `any`/`tool` rejected on Opus 5.5 / Sonnet 5.5 → `auto` + `strict: true`; no prefill → structured
outputs; handle `stop_reason: "refusal"` with server-side `fallbacks`; keep cached prefix byte-identical.

### 9.3 SMS and voice turns (later phase)

The same pipeline, with a different way in and a different reply format.

| Step | SMS | Voice |
|---|---|---|
| Ingress | Provider webhook to the API; signature verified; assistant found by the number texted; conversation keyed by the customer's number | The provider routes the call to the voice orchestrator; `apps/voice` receives each caller turn as text |
| Limits | Per number per day and per business; STOP/HELP handled before the engine | Call length, simultaneous calls, daily spend cap |
| Model | Chat profile | Fast voice profile; the reply is streamed sentence by sentence to speech |
| Reply | Plain text, short (about 300 characters where possible), links allowed | Short spoken sentences; no markdown, lists or links (a link is sent by text) |
| Tools | Same tools: knowledge search, request, booking | Same tools plus `transfer_call` and `send_text` ("I'll text you a link to send a photo") |
| After | Reply queued as a job, with retries | Summary, transcript and recording stored; owner alert queued |

## 10. Data model (core tables)

All tables carry `tenant_id` with RLS.

| Table                                              | Key fields                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `tenants`                                          | name, kind (business / demo), plan, status, owner_language, data_region, created_at                                  |
| `demos`                                            | a prospect demo built by operators: its business, status, operator's note, who built it, who it was handed over to (platform table) |
| `users`, `memberships`                             | role, ui_language                                                                                                    |
| `bots`                                             | audience, pack + variant + version, persona, **languages[]** (enabled), default_language, model_profile_id, settings |
| `bot_modules`, `bot_keys`                          | module config; public key, allowed origins, rate limits                                                              |
| `sectors`, `packs`, `pack_variants`, `modules`     | versioned config incl. **scope_level** (standard / professional)                                                     |
| `business_profile`                                 | hours & seasons, contact, booking/ordering URLs, **staff_languages[]**                                               |
| `notices`                                          | text + translations, starts_at, ends_at                                                                              |
| `knowledge_sources`, `documents`, `chunks`         | language per document/chunk, embedding, tsvector, trigram                                                            |
| `source_files`                                     | an uploaded price list or brochure waiting to be read (private; removed once its text is on the source)             |
| `page_stats`                                       | daily business page views and contact-button taps per assistant (totals only, no visitor data)                       |
| `qa_pairs`                                         | question variants, answer, **translations** (machine / owner-reviewed flag)                                          |
| `catalog_items`                                    | kind, name, description, price text, category, photo, main button, order, shown (built); structured attributes (Phase 3 feeds) |
| `conversations`, `messages`                        | channel, **language**, original + translated text, citations, scope flags, model/provider, tokens, cost              |
| `leads`                                            | type, fields, preferred_language, consent (CASL), status                                                             |
| `language_registry`                                | code, tier, script, rtl, enabled UI strings, reviewed status                                                         |
| `llm_providers`, `model_catalog`, `model_profiles` | credentials (encrypted, BYOK), capabilities, prices, fallbacks                                                       |
| `phone_numbers` | E.164 number, provider, bot, capabilities (voice / SMS / MMS), forwarding verified, status |
| `contacts` | phone, name, language, SMS opt-out, marketing consent (CASL) with date and source |
| `calls` | direction, from/to, status, duration, urgency, outcome, recording and transcript refs, summary, cost |
| `scheduled_messages` | transactional texts to send (confirmations, reminders, status), run time, status |
| `integration_connections` | provider, encrypted OAuth tokens, external job / appointment / client IDs |
| `usage_events`, `subscriptions`, `audit_logs`      | metering, billing, audit                                                                                             |

Phase 1 adds the business page: `catalog_items` holds the services and products shown on it (kind, name,
description, price text, photo, category, order), and `bots` gains a page slug and page settings. The
phone and SMS tables (`phone_numbers`, `contacts`, `calls`, `scheduled_messages`) come with the later
phase, when `conversations.channel` gains `sms` and `voice` (today: `hosted`, `inline`, `widget`, `playground`);
`usage_events` also meters voice minutes and SMS segments.

## 11. Ingestion pipeline

1. Crawl (sitemap → in-domain BFS, robots.txt, plan page caps, Playwright fallback)
2. Extract main content; detect language per page; keep headings, tables, prices
3. Menu photos/scans → vision OCR → owner confirms
4. Chunk (heading-aware ~300–500 tokens, language metadata)
5. Embed (multilingual model) + `tsvector` (EN/FR) + trigram index
6. **Pre-translate key facts** (Q&A, notices, menu, hours, greeting) into enabled languages (paid plans)
7. Enrich: suggest business-profile facts and starter FAQs
8. Scheduled re-sync with content hashing; re-translate only changed facts

## 12. Security, privacy, compliance

- Tenant isolation: RLS + cross-tenant tests in CI
- **PIPEDA:** privacy policy, consent, access/deletion, breach logging, client DPA
- **Public business pages:** the business publishes its own content and is responsible for it (ToS); a
  page is listed for search engines only once the owner publishes it; no customer data appears on it;
  requests and conversations stay private to the business.
- **CASL:** the product sends replies and transactional messages only (missed-call follow-up,
  confirmations, reminders, status, invoices). Marketing and recall messages need recorded consent. Every
  text thread honours STOP. Cold outbound SMS blasting is not offered as a feature. Our own prospecting
  texts and emails are commercial messages too: identification, an opt-out and a consent basis (§2.2).
- **Automated calls (CRTC):** no AI outbound sales calls. The CRTC rules on automatic dialing-announcing
  devices require prior express consent for solicitation. Outbound calls are limited to callbacks the
  customer asked for and emergency dispatch to the business's own on-call contacts.
- **Recorded calls and AI disclosure (PIPEDA, Quebec Law 25):** the greeting says it is an automated
  assistant on a recorded line; recordings are used only to serve the customer and improve the service;
  retention period per business; recordings and transcripts in Canadian storage; access and deletion
  requests cover them.
- **SMS sender registration:** follow the provider's current rules for business texting from Canadian local
  numbers. A2P 10DLC is the US carriers' registration scheme and applies to texts sent to US numbers;
  Bell, Rogers and Telus filter on their own terms. Confirm with Twilio or Telnyx what Canadian traffic
  needs (and whether toll-free verification or a short code is required at volume) before the pilots.
- **Tenant screening (Phase 2):** only the questions a property manager may lawfully ask (provincial
  human-rights codes and privacy law limit them); answers are recorded, no automated decisions.
- **Telephony security:** webhook signatures verified; number → business resolved on the server; outbound
  calls and texts limited to Canada and the US, with daily caps per business (toll fraud, SMS pumping);
  recordings in private storage behind expiring links.
- **911:** the assistant can't place an emergency call for a caller; it tells them to hang up and dial 911.
- **AODA:** WCAG 2.1 AA for widget and admin, in every UI language (incl. RTL)
- **Scope policy (§5):** locked rule, classifier, output checks, disclaimers, ToS — reviewed by a lawyer before Phase 3
- **PHIPA (Phase 3, clinics):** Canada-only data + LLM routing, no health details collected, retention limits
- **Abuse, quotas and noisy neighbours** (built): per-IP rate limit (Redis-backed across servers);
  per-visitor daily question limit (owner-adjustable, default 30); per-conversation cap (40 questions, then
  "start a new conversation"); monthly question limit per business (plan allowance, owner can set lower;
  counted atomically). Per-business questions-per-minute and concurrent-answer caps keep one busy business from
  slowing others — visitors see "Lots of people are asking questions right now", also shown when every AI
  provider is at capacity. Refusals are counted and shown on the admin **Usage** page (monthly meter, daily
  chart, by assistant/channel, estimated AI cost for owners/admins). Later: Cloudflare Turnstile on suspicious
  traffic, email alerts at 80 % / 100 %.
- Prompt injection: retrieved content and visitor text are data; server-side tool validation; works in all languages. Output check
  (built): a reply that gives away the instructions or tools (prompt section tags, internal tool names,
  rule headings) is taken back and replaced with "I can only help with questions about this business"
  (`withheld` flag; `packages/core/src/chat/output-check.ts`)
- Uploads: type detected from the content, size limits, private storage; an uploaded price list or
  brochure is deleted once its text is read (built). Malware scan: not built

## 13. Scalability path

| Stage  | Tenants   | What changes                                                                          |
| ------ | --------- | ------------------------------------------------------------------------------------- |
| Launch | 0–500     | One Postgres, one API service, one worker                                             |
| Growth | 500–5,000 | Read replicas, caching, more workers, partition `messages`                            |
| Scale  | 5,000+    | Dedicated vector store; cell-based sharding by tenant/region (incl. Canada-only cell) |

Voice scales on its own: `apps/voice` instances follow the number of simultaneous calls, and a managed
orchestrator caps simultaneous calls per account — check that cap before the winter-tire and tax seasons.

Product expansion via interfaces from day 1: channels (web, SMS, voice → WhatsApp/WeChat), more languages
(config only), audiences (public → staff), integrations, agency/white-label (local web agencies as resellers),
public API, AI add-ons (review replies, social posts in multiple languages).

## 14. Roadmap

Durations are estimates for 1–2 developers.

| Phase | Duration | Deliverables |
|---|---|---|
| **0. Foundations** | done | Monorepo, CI, docker-compose, schema + RLS, auth with orgs, tenant/bot CRUD, i18n framework (ICU, RTL-ready) |
| **1. Chat assistant + AI business page — pilots with trades and auto shops** | milestones 1.1–1.3 done; the rest ~2–4 weeks | **Built:** LLM gateway (Claude, OpenAI-compatible, offline provider); website crawl, text and Q&A sources; engine with tools, streaming, sources; hosted page, iframe, widget; admin portal (EN/FR); requests (lead capture & handoff); knowledge gaps; setup assistant; add-ons; workflows; photos; limits, usage page, operator console; **Trades and Auto repair packs**; the **business page** (header, contact buttons, services & products, gallery, hours, notices), friendly links and search-engine basics; urgent request flag with immediate email, quote requests with photos and industry fields, service-area check, call and book buttons, scope guard (keyword rules + auxiliary model). Setup without a website (interview, price list and brochure upload, services proposed from the sources); page statistics; evals EN/FR; prospect demo page generator. Accessibility pass (axe, WCAG 2.2 AA, `pnpm a11y`); done-for-you onboarding checklist (operator console). **To build:** Google listing details (§17.4) |
| **2. Paid launch + property management** | ~5–6 weeks | Stripe (CAD; setup fee + monthly plan); own domain for the page; page analytics (visits, questions, requests); booking through **Google Calendar and Jobber**; payment and deposit links; seasonal scripts; pack: **Property management & rentals** (maintenance requests, rental inquiry pre-screening after a privacy check); design-partner clinics and firms; agency white-label and referral tracking; Tier 2 reviewed UI strings |
| **Later phase — Phone and SMS** | ~6–8 weeks; starts after the paid launch, when pilots ask for it | **SMS first:** telephony (numbers, signed webhooks), missed-call text-back with a link to the business page, two-way SMS/MMS, owner alerts by text, reminders. **Then voice:** voice agent on a managed orchestrator with a fast model profile, emergency transfer, call log (recording, transcript, summary), EN then FR. Housecall Pro; status & pickup alerts from shop software; minutes and SMS metering |
| **3. Clinics and professional services (customer service only)** | ~6–8 weeks | Lawyer-reviewed scope policy & ToS; output check; Canada data residency + PHIPA measures; clinic booking integrations (as API access allows); **document chaser** with secure upload and vision check; minimal intake; catalog feeds; packs: Clinic (vet first), Pharmacy, Accounting & tax, Law firm, Immigration consultant, Insurance & financial, Real estate, **Car dealership**; with phone and SMS in place: waitlist backfill & recall |
| **4. Business tier and self-serve growth** | later | Self-serve local packs on demand (events, menu OCR, WordPress plugin); internal knowledge assistant (SSO, SharePoint/Drive), RFQ, careers; packs: Mining supply, Engineering, Manufacturing, Auto manufacturer & parts maker, Transportation, Utilities, Colleges; public API; WhatsApp |

Phone and SMS are a channel, not an industry phase: they can run before, alongside or after Phase 3. The
pack phases in code (1–4) follow the industry phases above.

**Phase 1 milestones**

| Milestone | Scope |
|---|---|
| **1.1 Chat end-to-end** (done) | Knowledge tables + RLS; LLM gateway; background jobs; website crawl, text and Q&A sources; retrieval; streaming answers with sources; conversation logging + usage metering; hosted chat page, inline iframe and floating widget; admin: knowledge sources, playground, share link & embed codes |
| **1.2 Business page** (done) | Page layout (header, contact buttons, hours and "open now", service area, footer); **services & products** (table, admin editor, cards on the page and in answers); photo gallery; business and personal presets; friendly link; content in the page's HTML with structured data; notices |
| **1.3 Requests for trades and auto shops** (done) | Urgent request flag with immediate email; quote request with photos; service-area check; vehicle and tire fields; booking and call buttons in answers; scope guard classifier |
| **1.4 Setup without a website** (done, except Google listing details) | Services and products, with prices, and the page description proposed from the sources and added to the page after the owner's review; price list and brochure upload (PDF with a text layer, DOCX, photo read by a vision model) as a knowledge source; interview mode (industry questions, EN/FR, answers saved as a knowledge source). **Waiting:** Google listing details, on open decision §17.4. Not covered yet: scanned PDFs (upload photos of the pages instead) and correcting the text read from a file |
| **1.5 Pilot readiness** (in progress) | Evals EN/FR for the Trades and Auto repair packs; prospect demo page generator; done-for-you onboarding checklist in the operator console; accessibility pass; basic page statistics (visits, questions, requests) — **built:** done-for-you onboarding checklist (operator console, Onboarding tab: seven steps, due one working day after the materials arrived, publish once the owner reviewed the page); page views, contact-button taps, questions and requests per day on the Business page tab; prospect demo page generator (operator console, Demos tab); accessibility checks (`apps/e2e`, `pnpm a11y`: axe against WCAG 2.2 AA on desktop and phone for the business page, chat, admin and operator console, all passing); evals (`packages/evals`, `pnpm evals`): 59 EN/FR cases for a plumbing company and a tire shop, scored on facts, triage, advice, invented prices, unanswered questions, requests and scope; DeepSeek V4.1 Flash (the planned production model, via OpenRouter) passes all of them, median first text 2.7 s (target 1.5 s) |

**MVP success criteria:** 10–20 trades and auto businesses with a live page in one or two cities, at least
half of them with no website or an outdated one before; a page live within one working day of receiving
the sources; ≥ 80 % of real customer questions answered correctly in EN and FR; every urgent request
emailed to the owner within one minute; 0 scope-policy failures on adversarial evals; p50 time-to-first-token
< 1.5 s; at least half of the pilots receive real customer requests through the page every week.

## 15. Quality & testing

- **Evals per pack × language:** golden Q&A in EN/FR + Tier 2 languages; adversarial scope cases (advice
  requests, emergencies, invented prices/stock, allergens) in every Tier 1–2 language; run on every prompt,
  pack or model change. **Built for Trades and Auto repair in EN/FR** (`packages/evals`): deterministic
  checks through the real chat engine; bar = 80 % of quality runs and no safety failure. Search runs
  on keywords alone unless embeddings are configured (`EMBEDDINGS_*`). Not yet: other
  packs, Tier 2 languages, a model-graded check of free-form answers
- Unit tests (chunking, ranking, prompt builder, pack inheritance, language detection, scope classifier),
  integration tests (ingestion, chat API), cross-tenant isolation tests
- Widget E2E (Playwright): RTL layout, CJK/Indic rendering, IME input, accessibility checks. **Built:**
  axe checks (WCAG 2.2 AA) of the business page, chat, admin and operator console on desktop and phone
  (`apps/e2e`); not yet in CI, RTL or CJK/Indic
- Business page: content present in the HTML without scripts, valid structured data, unpublished pages not
  listed, service cards and "open now" correct across time zones, mobile layout, WCAG checks
- **Voice and SMS evals per pack (later phase):** scripted scenarios (burst pipe, no heat, gas smell, quote request,
  booking, tire sizes, "is my car ready?") in EN, then FR, with background noise, accents and
  interruptions. Pass = right triage, right details captured, right booking; latency measured per turn
- Telephony tests (later phase): forged webhook rejected, STOP/HELP, number → business isolation, missed-call text sent
  exactly once, fallback when the orchestrator or the model fails
- Production: thumbs up/down, unanswered rate, scope-guard triggers, handoff rate, cost per conversation and
  per language; for phone and SMS: text-back time, calls answered, booked or captured rate, transfer rate,
  cost per call

## 16. Business model (illustrative, CAD — validate with pilots)

**AI business page with assistant — the first offer.** Most owners won't build the page themselves, so the
default is done-for-you; self-serve stays open for those who want it.

| Offer | Price | For | Includes | Phase |
|---|---|---|---|---|
| **Page setup** (one-time, done-for-you) | ~$300–750 | Businesses that want us to build it | Page built from their sources, services list, photos, QR code, Google listing link, review with the owner | 1 |
| **Business page** (monthly) | ~$49–149 | Trades, auto shops, property managers, solo contractors | Page + assistant + widget, requests with email alerts, a replies allowance, content updates on request | 1–2 |
| **Self-serve: Free trial** | $0 (14 days) | Everyone | 1 bot, 50 pages, 100 replies | built |
| **Self-serve: Local** | ~$29–49/mo | Restaurants, cafés, retail, salons, lodging, anyone who sets up alone | 1 bot, 200 pages, ~1,000 replies, EN/FR + automatic multilingual answers; seasonal pause | built |
| **Self-serve: Local Plus** | ~$69–99/mo | Same, busier or multilingual communities | 2 bots, 1,000 pages, ~3,000 replies, translated inbox, no branding, own domain | 2 |
| **Agency / white-label** | Wholesale price or revenue share | Local web design and SEO agencies | Client workspaces under the agency's name | 2 |
| **Referral** | 20 % recurring commission | Bookkeepers, IT managed-service providers | Per introduced customer, while they stay | 2 |
| **Clinic / Professional** | Set after Phase 2 | Clinics, accounting, legal, immigration | Integrations, Canada residency, scope output checks, document chaser | 3 |
| **Business** | from ~$499/mo | Industrial, institutions | Internal assistant, SSO, custom integrations | 4 |

- **The pitch:** a page that answers customers and takes requests, live this week, for less than a website,
  with nothing to maintain.
- **These prices are a starting assumption.** The playbook's $299–599/month was for a phone dispatcher that
  captures missed calls. A page with a chat assistant is compared with website builders ($20–40/month) and
  local web agencies (a one-time build plus upkeep), so it starts lower. Test the price in the pilots;
  consider the first months free in exchange for a reference.

**Phone and SMS assistant — the later-phase upgrade** (playbook pricing)

| Offer | Price | Includes |
|---|---|---|
| **Phone setup & integration** (one-time) | $750–2,000 | Price rules, emergency rules, local number and call forwarding, calendar / Jobber connection, test calls |
| **Managed phone and SMS assistant** (monthly) | $299–599 | Everything in the business page plan, plus phone answering, texting, an allowance of minutes and texts, monthly tuning, seasonal script changes |

- With a $450 average ticket, one saved call a month pays for it.
- **Include an allowance, not unlimited use.** Every voice minute and text has a cost. Working assumption
  to measure: roughly $0.15–0.35 per voice minute on a managed orchestrator.

Plan allowances stay editable in the operator console.

## 17. Open decisions

1. **First city and first industry** for the pilots. Recommended: trades in one Ontario city, and auto shops
   signed before the spring tire changeover.
2. **Price of the business page** and of its setup; whether pilots start free in exchange for a reference.
3. **Friendly link format** (`<our-domain>/<business-name>` or `<business-name>.<our-domain>`) and the
   product domain; own domains in Phase 2.
4. **Google listing details:** import through Google's Places API (check terms and cost) or enter by hand.
5. **How far the page goes.** Recommended: one page with fixed sections. No multi-page sites, blogs or
   online checkout; link to the shop or booking tool the business already has.
6. **When phone and SMS start.** Recommended trigger: a set number of paying page customers, or pilots
   asking for it. Then: telephony provider (Twilio or Telnyx, including Canadian SMS sender rules), managed
   voice orchestrator (Vapi or Retell) first, allowance and overage, call-recording defaults.
7. **Integration access** (Phase 2 and later). Confirm each before selling it: Jobber (developer app
   approval), Housecall Pro (API tied to plan level), ServiceTitan (partner program), Tekmetric / Mitchell1
   (partner access), Jane App (no general public API known). The fallback is a booking link plus a request
   to staff.
8. **Legal review timing:** our own outreach (CASL) and the ToS before the pilots; tenant screening
   questions before Phase 2; PHIPA measures and the scope policy before Phase 3.
9. Hosting provider and region.
10. Default provider + model per plan — decide after EN/FR + Tier 2 evals.
11. Final Tier 2 language list (proposed: Simplified & Traditional Chinese, Hindi, Punjabi, Urdu, Arabic,
    Persian, Ukrainian, Tagalog, Spanish) and budget for native-speaker review.
12. Indigenous languages: owner-provided phrases + human routing vs. deeper support with community partners.
13. Product name, team size and target launch date.
