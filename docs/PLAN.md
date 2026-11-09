# Traiblazer — Multi-Tenant AI Chatbot / RAG Platform for Small Businesses

> Working name taken from the project folder. Status: **plan, nothing built yet**.
> v1 2026-11-04 · v2: multi-provider LLM layer; industries refined from the Northern Ontario market research
> (`Northern_Ontario_Business_AI_Research.xlsx`, Oct 2026, 451 businesses) · v3: go-to-market starts with
> local small businesses (clinics, legal, mining, auto moved later); multilingual support for newcomer
> languages; professional industries limited to customer service — no professional advice · v4: translation
> done by the LLM only (no separate translation service at launch); automotive split into repair shops,
> dealerships and manufacturers.

## 1. Product in one paragraph

A small business signs up, picks its industry, pastes its website URL and/or uploads documents, and
within ~10 minutes has a branded AI assistant answering customer questions on its website from **its own
content** — in English, French and the languages of its customers (Chinese, Hindi, Punjabi, Arabic,
Ukrainian, and more). They install it by pasting one `<script>` tag (or a WordPress/Shopify plugin). In an
admin portal they manage the knowledge base, post notices ("closed today — storm"), read conversations
(auto-translated into their own language), collect leads, and see which questions the bot couldn't answer.
The bot is a **customer-service assistant**: it answers questions about the business and books/hands off —
it never gives professional advice. You (the operator) run one shared platform serving many businesses cheaply.

## 2. Target market and go-to-market order

**Launch market:** Thunder Bay (190 businesses in the list), Greater Sudbury (162), Sault Ste. Marie (99) —
all with their own website; 429 of 451 sites were live in Oct 2026.

**Strategy for a small company: start where the sale is easy.** Local businesses have short decisions
(the owner decides alone), low compliance risk and simple needs. Regulated professions and large B2B firms
have long sales cycles, procurement, liability concerns and integration demands — they come later, once we
have references, revenue and a proven product.

| Segment                               | Size in list          | Who                                                                                                                                                                                                               | Priority                            | Why                                                                                               |
| ------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Local businesses**                  | ~300 (≈ 68 %)         | Restaurants & bars 86, retail 71, arts & culture 27, cafés 22, personal care 22, tourism & recreation 22, professional/business services 21, grocery 12, producers & breweries 11, non-profits 8 — **2–30 staff** | **Phase 1–2 (focus)**               | Owner decides; simple needs (hours, menu, products, booking links); low risk; volume              |
| **Lodging**                           | 18                    | Motels, B&Bs, lodges, small hotels                                                                                                                                                                                | **Phase 1**                         | Small owner-run businesses with real booking/FAQ volume and many visitors from outside the region |
| **Professional services** (regulated) | ~60                   | Clinics 25, legal 21, accounting & financial 10, real estate 5, plus immigration consultants                                                                                                                      | **Phase 3** — customer service only | Harder to win, higher liability; enter with a strict no-advice scope (§5)                         |
| **Auto repair & service shops**       | 1 (under-represented) | Repair, tire, body/collision, glass, detailing                                                                                                                                                                    | **Phase 2**                         | Owner-run local businesses — same needs as trades (services, hours, booking, quotes with photos)  |
| **Car dealerships**                   | 8                     | New/used cars, powersports                                                                                                                                                                                        | **Phase 3**                         | Want inventory feeds, CRM and lead-response tooling — bigger integration effort                   |
| **Auto manufacturers & parts makers** | 0                     | OEMs, parts and components manufacturers                                                                                                                                                                          | **Phase 4**                         | Industrial B2B — distributors, specs, RFQs, internal knowledge; enterprise sales                  |
| **Industrial & institutions**         | ~50                   | Mining & resources 17, transportation 7, education 7, utilities 6, engineering 5, manufacturing 4, hospitals 3                                                                                                    | **Phase 4 / later**                 | Long enterprise sales, procurement, security reviews                                              |

**Needs that come up in many industries:**

1. **Many languages** — besides EN/FR (Francophone community in Sudbury), a growing number of customers
   are newcomers from **India, China, the Middle East, Ukraine, the Philippines** and elsewhere; non-profits
   also need Indigenous-language support (§6).
2. **Phone/voice** — restaurants (ordering/reservations), trades, lodging; many customers call instead of chat.
3. **Frequently changing facts** — seasonal hours, weather closures, specials, ski/trail conditions → notices.
4. **Structured data** — products, rooms, later vehicles and listings → feeds + lookup tools.
5. **Canadian compliance** — PIPEDA, CASL (lead follow-up), AODA accessibility; PHIPA only once clinics are added.
6. **Adjacent AI asks** (upsell later): review replies, social posts, product descriptions.

**Data notes:** revenue/employee figures in the sheet are benchmarks, not facts. One row (a French-language
law firm) has shifted columns; "Legal clinic (non-profit)" is filed under Health & Wellness; suburban trades
are under-represented; 22 websites were unreachable — check before reaching out.

## 3. Design principles

| Principle                                     | How                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Multi-tenant from day 1**                   | `tenant_id` on every table + Postgres Row-Level Security                                                                            |
| **Configure industries, don't code them**     | Sector → Pack → Variant built from reusable capability modules (§4)                                                                 |
| **Customer service, not professional advice** | Platform-wide locked scope rule + classifier + evals (§5)                                                                           |
| **Multilingual by default**                   | Answer in the visitor's language; language tiers; RTL/CJK/Indic support; owner sees translations (§6)                               |
| **Built for low traffic**                     | Shared stateless infra; pay-per-use LLM; no per-tenant servers                                                                      |
| **Zero-effort setup**                         | Website crawl → auto-filled business profile + FAQs → preview → copy snippet                                                        |
| **Grounded answers, honest "I don't know"**   | Answer only from tenant content, cite sources, fall back to lead capture / human                                                    |
| **Channel- and audience-agnostic engine**     | No web-specific code in the engine; voice and staff assistants later                                                                |
| **Provider-agnostic LLM layer**               | Anthropic, Bedrock, Azure Foundry, Vertex, OpenRouter, OpenAI, Gemini, Mistral, self-hosted (§9); the LLM also does all translation |

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

| Module                       | What it does                                                                                    | Phase |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | ----- |
| **Lead capture**             | Contact + pack fields + preferred language; CASL consent checkbox for marketing                 | 1     |
| **Human handoff**            | Email/SMS alert with translated summary; callback request                                       | 1     |
| **Notices & live status**    | Time-limited announcements (closures, specials, conditions), auto-translated                    | 1     |
| **Hours & seasons**          | Regular, holiday, seasonal hours; "open now?"                                                   | 1     |
| **Booking links**            | Links to existing booking tools (Square, Fresha, Vagaro, Calendly, booking engines)             | 1     |
| **Reservations & ordering**  | Reservation/ordering links; catering & custom-order requests                                    | 1     |
| **Menu**                     | Menu from PDF/photo (vision OCR); dietary/allergen Q&A with "confirm with staff"                | 1     |
| **Multilingual**             | Visitor-language answers, widget UI languages, translated owner view (§6)                       | 1     |
| **Catalog lookup**           | Structured feeds (CSV, Shopify, Square, WooCommerce) — products, rooms; later vehicles/listings | 2     |
| **Events & tickets**         | Event calendar Q&A + ticket links                                                               | 2     |
| **Quote request**            | Guided questions + photo upload (trades, event services, printing)                              | 2     |
| **Donations & volunteering** | Links + FAQs                                                                                    | 2     |
| **Age gate**                 | Alcohol 19+ (Ontario), tattoo/piercing 18+ wording                                              | 1     |
| **Safety & escalation**      | Emergency keywords → urgent message + phone; crisis lines (9-8-8, 911)                          | 1     |
| **Image upload**             | Visitor photos (tattoo references, repair issues) via vision models                             | 2     |
| **Booking integrations**     | Real availability via APIs (Square, Jane App, Calendly, Google Calendar)                        | 3     |
| **Intake (minimal)**         | Contact + topic category only for professional packs — no case/health details (§5)              | 3     |
| **Careers & recruiting**     | Job Q&A, application link                                                                       | 3     |
| **Internal knowledge**       | Staff-only assistant over private docs, SSO, permissions                                        | 4     |

### 4.3 Pack catalog by phase (research counts in brackets)

| Phase          | Sector                                           | Packs → variants                                                                                                                                                                    | Key modules                                                                                                                        | Notes                                                                            |
| -------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **1 — launch** | Food & Drink                                     | **Restaurant & bar** [86] → casual, fine dining, pub/bar, buffet, takeout · **Café & bakery** [22] → café, bakery/custom cakes, coffee roaster                                      | Menu, reservations & ordering, hours, notices, age gate                                                                            | Largest group; allergens always "confirm with staff"                             |
| **1 — launch** | Retail                                           | **Retail store** [71] → clothing/outdoor, florist, gift/artisan, hardware, jewellery, books/hobby, **international/specialty food & goods**                                         | Hours, notices, product FAQs (catalog in Phase 2)                                                                                  | Never invent stock or prices                                                     |
| **1 — launch** | Personal care                                    | **Salon, spa & barber** [16] · **Tattoo & piercing** [6]                                                                                                                            | Booking links, age gate, deposits link                                                                                             | Tattoo: 18+, consultations, aftercare                                            |
| **1 — launch** | Hospitality & Tourism                            | **Lodging** [18] → motel, B&B, lodge/outfitter, small hotel · **Attractions, tours & recreation** [22] → tours, ski/trails, golf, activity venues                                   | Booking links, notices & conditions, hours & seasons, multilingual                                                                 | Visitors from outside the region → multilingual matters most here                |
| **1**          | Generic                                          | Fallback for anything else                                                                                                                                                          | Lead capture, handoff, hours                                                                                                       |                                                                                  |
| **2**          | Food & Drink                                     | **Grocery & market** [12] → farmers market, specialty/ethnic grocery, butcher · **Brewery & producer** [11]                                                                         | Catalog, events, age gate                                                                                                          | Ethnic groceries serve newcomer communities → multilingual showcase              |
| **2**          | Arts & Events                                    | **Arts, culture & events** [27] → gallery, museum, theatre, festival, music venue                                                                                                   | Events & tickets, donations                                                                                                        | Small budgets → Local plan                                                       |
| **2**          | Fitness                                          | **Gym & studio** [~6] → gym, yoga, martial arts                                                                                                                                     | Booking links, class schedule                                                                                                      | No health/exercise advice beyond published info                                  |
| **2**          | Automotive (local)                               | **Auto repair & service shop** → general repair, tires, body/collision, glass, oil change, detailing                                                                                | Booking links, hours & seasons (winter-tire rush), quote request + photos, notices                                                 | No diagnosis guarantees or binding repair prices — "estimate after inspection"   |
| **2**          | Professional & business services (non-regulated) | **Business services** [21] → marketing agency, IT/web, photography, printing, event planning, security, cleaning                                                                    | Quote request, booking links                                                                                                       | Customer service + quotes                                                        |
| **2**          | Home & Construction                              | **Trades & home services** → plumbing, HVAC, electrical, cleaning, landscaping, snow removal                                                                                        | Quote request, service-area check, safety & escalation                                                                             | Gas / no heat → urgent escalation                                                |
| **2**          | Education (small)                                | **Tutoring, language & driving schools, music schools**                                                                                                                             | Programs, schedules, booking                                                                                                       | Language schools fit newcomer demand                                             |
| **2**          | Community                                        | **Non-profit & settlement services** [8] → social services, newcomer/settlement, youth, community                                                                                   | Multilingual, donations & volunteering, safety & escalation                                                                        | Resource navigation only, minimal personal data                                  |
| **3**          | Health & Wellness                                | **Clinic** [25] → dental, physio/chiro, vision & hearing, counselling, aesthetics · **Pharmacy** [2]                                                                                | Booking, minimal intake, safety & escalation                                                                                       | **Customer service only** (§5); PHIPA + Canada data residency required first     |
| **3**          | Legal & Financial                                | **Law firm** [21] · **Accounting & tax** [5] · **Insurance broker** [2] · **Credit union / advisory** [3] · **Immigration consultant**                                              | Booking, minimal intake                                                                                                            | **Customer service only** (§5)                                                   |
| **3**          | Real Estate                                      | **Brokerage / agent** [5]                                                                                                                                                           | Listings feed, showing booking                                                                                                     | No valuations or legal/financial guidance                                        |
| **3**          | Automotive (sales)                               | **Car dealership** [8] → new & used cars, powersports/RV/boat                                                                                                                       | Vehicle inventory feed (catalog lookup), test-drive & service booking, trade-in and financing _inquiry_ forms                      | No final prices, trade-in values or financing terms — customer service only (§5) |
| **4**          | Industrial & Institutions                        | **Mining supply & services** [17], **Engineering** [5], **Manufacturing** [4], **Auto manufacturer & parts maker** [0], **Transportation** [7], **Utilities** [6], **Colleges** [7] | RFQ, careers, internal knowledge, voice; for auto makers: dealer/distributor locator, product specs, warranty & recall info lookup | Business tier; enterprise sales                                                  |

**Launch packs (Phase 1):** Restaurant & bar, Café & bakery, Retail store, Salon/spa/barber + tattoo,
Lodging + attractions & tours, Generic. Together ≈ 240 businesses in the research list (over half),
all owner-run, all low-risk.

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
- **Voice (later):** speech-to-text/text-to-speech coverage per language (e.g. Mandarin vs Cantonese, Punjabi)
- **Evals:** 30–50 questions per launch pack per Tier 2 language, sampled native-speaker review

## 7. Feature scope

### 7.1 Chat surfaces: hosted page, iframe embed, widget

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

### 7.2 Client admin portal (EN/FR first)

1. **Onboarding wizard:** sector → pack → variant → website URL → files/menu photos → confirm business
   profile (hours, phone, booking links, **staff languages**) → choose bot languages → preview → embed code
2. **Knowledge base:** pages, PDF/DOCX, menu images, Q&A pairs, notes, feeds (Phase 2); per-language
   versions; **Q&A pairs override everything**
3. **Notices** with start/end dates, auto-translated
4. **Playground:** test in any language; "fix this answer" → Q&A pair
5. **Bot settings:** persona, greeting, languages, hours & seasons, modules, lead fields, handoff contacts,
   custom instructions (scope-checked, §5)
6. **Inbox** (auto-translated), **Leads**, **Analytics** (incl. languages used, knowledge gaps)
7. **Install**, **Team & roles**, **Billing & usage** (CAD)

### 7.3 Operator console

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
- **Prospect demo generator:** build a private demo bot from a prospect's public website
- System health: ingestion queue, errors, latency, provider fallbacks, scope-classifier triggers

## 8. Architecture

```
                      ┌──────────────────────────────┐
 Visitor's browser ──►│ chat page / iframe / widget  │       Phone (Phase 3) ──► voice gateway ─┐
                      └──────────────┬───────────────┘                                          │
                                     │ HTTPS + SSE                                              │
 Business owner  ──► Admin portal (Next.js) ──┐                                                 │
                                     ▼        ▼                                                 ▼
                      ┌──────────────────────────────┐        ┌──────────────────────┐
                      │ API service (stateless)       │──────►│ LLM gateway           │──► Anthropic / Bedrock / Azure
                      │ - conversation engine         │        │ chat + translation,   │    Foundry / Vertex / OpenRouter /
                      │ - scope guard, language layer │        │ routing, fallbacks,   │    OpenAI / Gemini / self-hosted
                      │ - admin REST API, auth, quotas│        │ metering              │
                      └───┬──────────┬───────────┬───┘        └──────────────────────┘
                          ▼          ▼           ▼ enqueue jobs
                   PostgreSQL     Redis      Queue ──► Worker(s): crawl → parse/OCR → chunk → embed → index;
                   + pgvector   (rate limit,           pre-translation; feed sync; re-sync; analytics
                   (RLS)         cache)
                          ▲
                          └── Object storage (S3/R2) — uploads, menu images
```

### 8.1 Recommended stack (TypeScript end-to-end)

| Layer             | Choice                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo          | pnpm + Turborepo                                                                                                                               |
| Admin portal      | Next.js + Tailwind + shadcn/ui + i18n (ICU messages, RTL-ready)                                                                                |
| Chat page + widget | Preact + Vite: one chat page (hosted link / iframe) + a tiny `widget.js` loader, served by the API with per-bot `frame-ancestors`              |
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
| Observability     | Sentry, OpenTelemetry, per-message usage & cost in DB                                                                                          |

> Alternative: Python (FastAPI) backend (LiteLLM for the gateway); chat page and admin stay TypeScript.

### 8.2 Monorepo layout

```
traiblazer/
  apps/       admin/  api/  worker/  widget/  voice/ (Phase 3)
  packages/
    core/             conversation engine, retrieval, prompt builder
    scope-guard/      scope rule, advice classifier, output check, safe templates
    i18n/             UI strings (ICU), language registry & tiers, RTL helpers
    modules/          capability modules
    db/               schema, migrations, RLS
    llm/              LLM gateway (incl. translate helper), embeddings, vector-store interface
    industry-packs/   sectors/packs/variants YAML + schema
    integrations/     connectors (Square, Shopify, Calendly, …)
    shared/
  infra/  evals/ (per pack × language)  docs/
```

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

Claude adapter notes: `output_config.effort` (`low` for chat); thinking on Opus 5.5 can't be disabled; forced
`tool_choice` `any`/`tool` rejected on Opus 5.5 / Sonnet 5.5 → `auto` + `strict: true`; no prefill → structured
outputs; handle `stop_reason: "refusal"` with server-side `fallbacks`; keep cached prefix byte-identical.

## 10. Data model (core tables)

All tables carry `tenant_id` with RLS.

| Table                                              | Key fields                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `tenants`                                          | name, plan, status, owner_language, data_region, created_at                                                          |
| `users`, `memberships`                             | role, ui_language                                                                                                    |
| `bots`                                             | audience, pack + variant + version, persona, **languages[]** (enabled), default_language, model_profile_id, settings |
| `bot_modules`, `bot_keys`                          | module config; public key, allowed origins, rate limits                                                              |
| `sectors`, `packs`, `pack_variants`, `modules`     | versioned config incl. **scope_level** (standard / professional)                                                     |
| `business_profile`                                 | hours & seasons, contact, booking/ordering URLs, **staff_languages[]**                                               |
| `notices`                                          | text + translations, starts_at, ends_at                                                                              |
| `knowledge_sources`, `documents`, `chunks`         | language per document/chunk, embedding, tsvector, trigram                                                            |
| `qa_pairs`                                         | question variants, answer, **translations** (machine / owner-reviewed flag)                                          |
| `catalog_items`                                    | kind, structured attributes, price, status (Phase 2)                                                                 |
| `conversations`, `messages`                        | channel, **language**, original + translated text, citations, scope flags, model/provider, tokens, cost              |
| `leads`                                            | type, fields, preferred_language, consent (CASL), status                                                             |
| `language_registry`                                | code, tier, script, rtl, enabled UI strings, reviewed status                                                         |
| `llm_providers`, `model_catalog`, `model_profiles` | credentials (encrypted, BYOK), capabilities, prices, fallbacks                                                       |
| `usage_events`, `subscriptions`, `audit_logs`      | metering, billing, audit                                                                                             |

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
- **CASL:** opt-in checkbox for marketing follow-up; also check our own outreach to prospects
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
- Prompt injection: retrieved content and visitor text are data; server-side tool validation; works in all languages
- Uploads: type/size limits, malware scan, private storage

## 13. Scalability path

| Stage  | Tenants   | What changes                                                                          |
| ------ | --------- | ------------------------------------------------------------------------------------- |
| Launch | 0–500     | One Postgres, one API service, one worker                                             |
| Growth | 500–5,000 | Read replicas, caching, more workers, partition `messages`                            |
| Scale  | 5,000+    | Dedicated vector store; cell-based sharding by tenant/region (incl. Canada-only cell) |

Product expansion via interfaces from day 1: channels (web → voice → SMS/WhatsApp/WeChat), more languages
(config only), audiences (public → staff), integrations, agency/white-label (local web agencies as resellers),
public API, AI add-ons (review replies, social posts in multiple languages).

## 14. Roadmap

| Phase                                       | Duration (1–2 devs) | Deliverables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0. Foundations**                          | ~1 week             | Monorepo, CI, docker-compose, schema + RLS, auth with orgs, tenant/bot CRUD, i18n framework (ICU, RTL-ready)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **1. MVP — local businesses**               | ~5–6 weeks          | LLM gateway (Anthropic + OpenRouter, fallbacks); ingestion (crawl, PDF/DOCX, menu photos, Q&A, text); engine (hybrid RAG, streaming, citations); **scope guard**; language layer (Tier 1 full, Tier 2/3 answers, query translation, RTL/CJK widget); modules: lead capture, handoff, hours & seasons, notices, booking links, reservations & ordering, menu, age gate, safety; widget + admin (EN/FR); packs: **Restaurant & bar, Café & bakery, Retail, Salon/spa/barber + tattoo, Lodging + attractions, Generic**; metering & limits; evals EN/FR; prospect demo generator |
| **2. Paid launch**                          | ~5 weeks            | Stripe (CAD); Tier 2 reviewed UI strings + evals; owner inbox auto-translation and pre-translated key facts (both via the LLM); catalog feeds (Shopify, Square, CSV); quote requests + image upload; packs: Grocery & market, Brewery & producer, Arts & events, Fitness, Business services, Trades & home services, **Auto repair & service shop**, Small education, Non-profit & settlement; analytics + knowledge gaps; live inbox; WordPress plugin; more LLM adapters (Bedrock, Azure, Vertex, OpenAI-compatible) + BYOK                                                 |
| **3. Professional (customer service only)** | ~6–8 weeks          | Lawyer-reviewed scope policy & ToS; output check; Canada data residency + PHIPA measures; booking integrations (Jane App, Square, Calendly); minimal intake; packs: Clinic, Pharmacy, Law firm, Accounting & tax, Insurance & financial, Immigration consultant, Real estate, **Car dealership** (vehicle inventory feed); **voice/phone channel** (EN first, then Tier 2); SMS/WhatsApp; agency/white-label                                                                                                                                                                  |
| **4. Business tier**                        | later               | Internal knowledge assistant (SSO, SharePoint/Drive), RFQ, careers; packs: Mining supply, Engineering, Manufacturing, **Auto manufacturer & parts maker**, Transportation, Utilities, Colleges; public API                                                                                                                                                                                                                                                                                                                                                                    |

**Phase 1 milestones**

| Milestone | Scope |
|---|---|
| **1.1 Chat end-to-end** | Knowledge tables + RLS; LLM gateway (Claude via Anthropic SDK, OpenAI-compatible adapter for OpenRouter & others, offline test provider); background jobs; website crawl, text and Q&A sources; full-text + trigram retrieval (vector search when an embedding provider is configured); query translation for non-EN/FR questions; streaming answers with sources; conversation logging + usage metering; **hosted chat page, inline iframe and floating widget**; admin: knowledge sources, playground, share link & embed codes |
| 1.2 Modules | Lead capture & handoff (tools), hours & "open now", notices, booking/ordering links, age gate, safety escalation; scope guard classifier |
| 1.3 Content | PDF/DOCX upload, menu photos (vision OCR), auto-filled business profile; pack content for the 7 launch packs |
| 1.4 Launch readiness | Evals EN/FR + Tier 2 answers, prospect demo generator, accessibility pass, billing hook-up of plans (web version + QR codes, plan limits, quotas, abuse protection, usage page and operator console with editable plans/policies already delivered) |

**MVP success criteria:** signup → working bot in under 15 minutes; ≥ 80 % of real visitor questions
answered correctly in EN and FR and ≥ 75 % in Tier 2 eval languages; 0 scope-policy failures on adversarial
evals; p50 time-to-first-token < 1.5 s; 10–20 pilot customers from the launch packs in Thunder Bay, Sudbury
and Sault Ste. Marie.

## 15. Quality & testing

- **Evals per pack × language:** golden Q&A in EN/FR + Tier 2 languages; adversarial scope cases (advice
  requests, emergencies, invented prices/stock, allergens) in every Tier 1–2 language; run on every prompt,
  pack or model change
- Unit tests (chunking, ranking, prompt builder, pack inheritance, language detection, scope classifier),
  integration tests (ingestion, chat API), cross-tenant isolation tests
- Widget E2E (Playwright): RTL layout, CJK/Indic rendering, IME input, accessibility checks
- Production: thumbs up/down, unanswered rate, scope-guard triggers, handoff rate, cost per conversation and per language

## 16. Business model (illustrative, CAD — validate with pilots)

| Plan             | Price         | For                                                                              | Includes                                                                                                    | Phase |
| ---------------- | ------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----- |
| Free trial       | $0 (14 days)  | Everyone                                                                         | 1 bot, 50 pages, 100 replies                                                                                | 1     |
| **Local**        | ~$29–49/mo    | Restaurants, cafés, retail, salons, lodging, tourism, arts, non-profits          | 1 bot, 200 pages, ~1,000 replies, EN/FR + automatic multilingual answers, notices, menu; seasonal pause     | 1     |
| **Local Plus**   | ~$69–99/mo    | Same, busier or multilingual communities                                         | 2 bots, 1,000 pages, ~3,000 replies, pre-translated key facts, translated inbox, catalog feeds, no branding | 2     |
| **Professional** | ~$149–249/mo  | Clinics, legal, accounting, real estate, car dealerships (customer service only) | Integrations, minimal intake, Canada residency, scope output checks                                         | 3     |
| **Business**     | from ~$499/mo | Industrial, institutions                                                         | Internal assistant, SSO, voice, custom integrations                                                         | 4     |
| **Agency**       | ~$249+/mo     | Local web/marketing agencies                                                     | 10+ client workspaces, white-label                                                                          | 3     |

Optional one-time setup service (C$200–500 Local, more for Professional). Overage per extra replies.

## 17. Open decisions

1. Backend language: **TypeScript end-to-end** (recommended) vs Python (FastAPI)
2. Hosting provider and region
3. Default provider + model per plan — decide after EN/FR + Tier 2 evals
4. Final Tier 2 language list (proposed: Simplified & Traditional Chinese, Hindi, Punjabi, Urdu, Arabic,
   Persian, Ukrainian, Tagalog, Spanish) and budget for native-speaker review
5. Confirm launch packs: Restaurant & bar, Café & bakery, Retail, Salon/spa/barber + tattoo, Lodging + attractions
6. Indigenous languages: owner-provided phrases + human routing vs. deeper support with community partners
7. Product name / domain, team size and target launch date
