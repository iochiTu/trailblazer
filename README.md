# Traiblazer

Multi-tenant AI assistant (chatbot / RAG) platform for small businesses. See [docs/PLAN.md](docs/PLAN.md)
for the product plan and roadmap.

**Status:** Phase 1, milestones 1.1 (chat end-to-end), 1.2 (business page) and 1.3 (requests for
trades and auto shops: urgent triage and alerts, request details and photos, service-area check, call
and book buttons), most of 1.4 (setup without a website: services and prices proposed from the
sources, price-list and brochure upload, interview), and part of 1.5 (page statistics, EN/FR evals
for the Trades and Auto repair packs) — knowledge sources
(website crawl, text, Q&A, uploaded price lists and brochures, interview answers), retrieval, streaming answers with sources, multi-provider LLM gateway,
three ways to put the chat on a customer's site (business page, inline iframe, floating widget), and
the business page itself: services and products, notices, gallery, hours, friendly link, search-engine
basics. See PLAN.md §14 for what's next.

## Layout

```
apps/
  api/              Fastify API: auth, tenants, bots, knowledge, public chat, chat page + widget.js
  admin/            Next.js admin portal (EN/FR): knowledge, test chat, share & install, requests, conversations
  chat/             Preact chat page (hosted link / iframe / widget panel) + widget.js loader
  worker/           Background jobs: website crawling, reading uploaded files, indexing
  e2e/              Accessibility checks in a real browser (Playwright + axe, `pnpm a11y`)
packages/
  core/             Chat engine, tools, retrieval, prompt (locked platform rules), crawler, job queue
  llm/              LLM gateway: Claude (Anthropic SDK), OpenAI-compatible (OpenRouter…), offline provider; tool calling
  db/               Drizzle schema, migrations (incl. row-level security), withTenant()
  addons/           Add-on market: add-on contract, registry, built-in add-ons (email notifications, online shop)
  i18n/             Language registry (tiers, RTL), UI messages (ICU), language negotiation
  industry-packs/   Industry catalog + templates (response guidelines, suggested questions, workflows)
  evals/            Answer-quality and safety evals for the pilot packs, EN/FR (`pnpm evals`)
  shared/           Zod request schemas shared by API and admin
infra/postgres/     Local database init (roles, test database)
```

## Chat surfaces

| Surface | What the business uses |
|---|---|
| Business page (hosted chat page) | `http://localhost:4000/<friendly-link>` or `http://localhost:4000/c/<public-key>`: the business's public page with the chat on it, to share anywhere (QR codes, Google listing, social media) |
| Inline iframe | `<iframe src="http://localhost:4000/c/<public-key>?embed=inline">` inside one of their pages |
| Floating widget | `<script src="http://localhost:4000/widget.js" data-bot="<public-key>" async></script>` |

All three load the same chat app. It is served with `frame-ancestors` limited to the bot's allowed
websites (plus the admin portal), and talks to the API on its own origin. The admin's
**Share & install** tab shows the ready-to-copy codes.

## Business page

A top-level visit to the hosted link is the business's **public page** (PLAN §7.1): header with name,
picture, description, "open now" and service area; Call / Book / Email / Directions buttons; running
notices; services and products as cards; photo gallery; opening hours; and a footer with address,
licences and languages. The chat sits beside the content on wide screens and right under the header
on phones. `?embed=…` (iframe, widget, test chat) still gets the plain chat.

- **Rendered by the API** (`apps/api/src/page/`), so the content is in the HTML when it loads: it works
  without JavaScript and search engines read it. The head has the title, description, canonical
  link, Open Graph tags and schema.org structured data (`LocalBusiness` subtype per industry, e.g.
  `Plumber`, `TireShop`, with hours and offers). The chat app (`apps/chat`) then mounts in `#app`;
  "Ask about this" / "Request a quote" / "Book" buttons on the cards send their text to the chat.
- **Listed by search engines** only when the assistant is active, its web version is on and the owner
  hasn't kept it unlisted; otherwise `noindex`. `<chat-domain>/sitemap.xml` lists exactly those pages
  (at their friendly link when they have one; `SECURITY DEFINER` function `app_listed_pages`, which
  also leaves out suspended businesses and prospect demos), and `/robots.txt` points to it and keeps
  robots out of `/v1/`.
- **Friendly link** `<chat-domain>/<slug>` (`bots.page_slug`, unique across the platform, resolved by
  the `SECURITY DEFINER` function `app_resolve_page_slug`). Platform words are reserved
  (`RESERVED_PAGE_SLUGS` in `@traiblazer/shared`). The `/c/<key>` link keeps working and points
  search engines at the friendly link.
- **Services & products** (`catalog_items`, RLS): name, description, price in the owner's words,
  category, photo, main button (ask / quote / book), order, shown or hidden; up to 60 per assistant.
  **Notices** (`notices`, RLS): text with optional start and end, up to 10. Both are also given to the
  assistant (`<services>` in the cached prompt block, `<notices>` next to the date), and it quotes
  prices only as written.
- **Page details** on the business profile: short description, service area, licences & insurance.
  Layout preset (business or personal) and listing are in `bots.settings.page`.
- Edited on the admin's **Business page** tab, with a live preview (`/c/<key>?preview=1` in an iframe:
  works before publishing, chats are logged as tests). Page text is English or French (the
  assistant's default language); the chat on it still answers in the visitor's language.
- **Page statistics** ("How your page is doing" on the Business page tab, 7/30/90 days): page views
  and taps on the contact buttons (`page_stats`, RLS: daily totals per assistant in the reporting time
  zone, nothing about the visitor), next to the questions visitors asked (page and website chat) and
  the requests they left, both without the owner's tests. A view is one visit to the published page
  (active assistant, web version on): the page sends `view` once per browser tab, so a refresh or
  coming back in the same tab isn't counted again (a flag in session storage, never sent anywhere).
  Not counted: `?embed`, `?preview=1`, robots and prefetches (`fromPerson` in
  `apps/api/src/lib/page-stats.ts`). The buttons carry `data-action`; the chat app sends views and
  taps with `navigator.sendBeacon` to `POST /v1/public/page-events` (same origin, 30 per minute per
  address). API: `GET /v1/tenants/:t/bots/:b/page-stats?days=30`.

## Add-ons

Businesses extend an assistant from the **Add-ons** tab (the add-on market). Today: **Email
notifications** (new conversation, new request from a visitor, unanswered question) and **Online shop** (shop link in answers + a
"Shop online" button in the chat); a few more are listed as "coming soon".

An add-on is a definition in `packages/addons/src/builtin/` registered in `registry.ts`: id, version,
category, EN/FR text, settings fields (the portal builds the form from them), a Zod schema, and pure
hooks: `prompt` (text in the assistant's instructions), `chatLinks` (chat page buttons) and `onEvent`
(chat events → effects). Hooks never do I/O; effects are queued as `addon.effect` jobs and run by the
worker, which re-checks the add-on is still on. Installations live in `bot_addons` (RLS); settings are
re-validated on every save and read, and `version`/`migrate` handle setting changes. Emails go through
`SMTP_URL`/`MAIL_FROM`; without them the worker logs each email instead. The owner's test chat
(playground) never triggers notifications.

## AI providers

Without API keys, chat uses an **offline test provider** that quotes matching sentences from the
business's information, so everything works locally at no cost. Set `ANTHROPIC_API_KEY` (and/or
`OPENROUTER_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL`) in `.env` for real answers; see `.env.example`.
With an Anthropic key the default routes are `claude-opus-5-5` for answers (low effort, server-side
refusal fallback enabled) and `claude-haiku-5-5` for query rewriting/translation. Owner-side jobs (the
setup assistant) use the chat routes unless `LLM_AGENT_ROUTES` is set.

Reasoning models behind an OpenAI-compatible endpoint (a local Qwen on Ollama, for example) think
before every reply, which can take most of the time. `OPENAI_COMPATIBLE_REASONING_EFFORT` (and
`OPENROUTER_REASONING_EFFORT`) set how much: `none`, `minimal`, `low`, `medium`, `high`, `xhigh` or
`max`. The value is sent with every request to that provider (`reasoning_effort`; OpenRouter gets
`reasoning.effort`) and nothing is sent when it is unset, because endpoints reject the field for models
that don't reason. Which values a model honours is up to the endpoint: Ollama applies the ones the
model supports and falls back to the model's default otherwise.

## Tools

The assistant can call **tools** while it answers: the model asks for a tool, the chat engine runs it
on the server under the assistant's own business, and the model continues with the result (up to 3
rounds per answer). Today there are three:

- `search_knowledge`: look the business's information up again with other words, or once per part of
  a multi-part question.
- `request_follow_up`: pass a visitor's request to the business (see **Requests** below). Its schema
  includes the industry's request fields (`leadFields` in the template: address, vehicle, tire size…).
- `check_service_area`: check a town, address or postal code against the business's own lists
  (`business_profiles.service_towns`, `service_postal_prefixes`: "N1H", or "N1" for every code starting
  with it). Only offered when the business listed them.

Booking through calendars will be added the same way.

- A tool is a definition in `packages/core/src/chat/tools/` (registered in `index.ts`): name,
  description, a Zod schema for its input and `run`. Every call is validated against the schema first; a bad call, an unknown tool or a
  failing tool becomes an error result the model can recover from, never a failed answer.
- Tool calling is provider-neutral (`packages/llm`): Claude models always support it; for OpenRouter and
  OpenAI-compatible endpoints list the models that do in `OPENROUTER_TOOL_MODELS` /
  `OPENAI_COMPATIBLE_TOOL_MODELS` (`*` for all). Models that can't call tools get the same request
  without them and answer as before; so does the offline provider. Without tools an assistant can't
  save visitors' requests or check service areas, so the API logs a warning at startup when no chat
  model can call them.
- What a tool returns is reference data like the knowledge base, never instructions. Tools used are
  recorded on the answer (`flags.tools`) and the answer's tokens and cost cover every model call.
- The reply is what the model writes after its last tool call. If it wrote to the visitor before a
  tool call and writes again after it, the chat stream sends a `reset` event and the later text
  replaces the earlier text (models often repeat themselves there). The same event takes back text an
  OpenAI-compatible server streamed that turned out to be the model's thinking (`<think>` tags are
  stripped from replies).

## Requests (lead capture and handoff)

When a visitor wants to be called back, asks for a quote or a booking, has a complaint, or asks
something the assistant can't answer, the assistant takes their name and an email or phone number and
saves a **request** for the business (`leads` table, RLS). Staff work through requests on the admin's
**Requests** tab (new → in progress → done, link to the conversation, delete); the tab shows how many
are new. With the **Email notifications** add-on the owner also gets an email for each one.

- The assistant can pass on only contact details the visitor typed in that conversation; anything else
  (a guess, or an address found on the business's own pages) is refused and it asks again. At most 3
  requests per conversation.
- It saves and notifies; it never books, orders or confirms anything, and says so.
- Requests left in the owner's test chat are kept (marked "Test") but never emailed.
- Each assistant can turn this off (`settings.followUps`, the checkbox on the Requests tab). It needs a
  model that can call tools (see above); without one the assistant gives the business's phone or email
  as before.
- Requests are personal data: every member of the business can read them, editors can change or
  delete them, and the audit log records who did, without the visitor's details.
- A request carries the industry's details the visitor gave (`leads.details`, labelled for the owner)
  and the photos they sent in the conversation (`leads.attachment_ids`, up to 6), shown on the
  Requests tab and counted in the email.

## Urgent problems (triage) and buttons in answers

Every visitor message is sorted before the answer (`packages/core/src/chat/triage.ts`):

- **Keyword rules**, instant, English and French: the platform's **danger** words for every business
  (gas smell, carbon monoxide alarm, fire, smoke, sparks) and each industry's **urgent** words
  (`triage` in the template: burst pipe, no heat, car won't start…). Whole words, without case or
  accents.
- **The auxiliary model**, any language: the search-query call also returns a `TYPE:` line (`danger`,
  `urgent`, `advice` or `routine`). For a first message in English or French it runs alongside the
  answer, so it never delays the reply; for follow-ups and other languages it already runs first and
  its reading reaches the answer's prompt as `<triage>`.

The higher reading wins (`flags.urgency` on the answer; `flags.advice` for advice requests, which the
assistant declines kindly). When a message is urgent or a danger:

- the chat shows a banner at once with a **Call** button (and, for a danger, the 911 safety message),
  and the reply gets a Call button;
- a request the visitor leaves is marked **urgent**, sorted first on the Requests tab, and emailed right
  away by the platform (job `request.urgent_alert`, priority 10, ahead of crawls): to the Email
  notifications add-on's address when that add-on is on, otherwise to the business's owners and
  admins. The add-on doesn't send its own email for it, so it arrives once.

**Buttons in answers:** the model writes `[[action:call]]` or `[[action:book]]`; the engine removes the
marker and sends a button whose link comes from the business profile (phone number, booking link),
never from the model. Buttons are kept on the message (`flags.actions`) and come back with the
conversation history.

## Questions the assistant couldn't answer (knowledge gaps)

When the business's information doesn't contain the answer, the assistant says so and ends its reply
with a hidden marker naming what was missing (`[[gap: gluten-free options]]`). The chat engine removes
the marker from the stream (`packages/core/src/chat/markers.ts`, the same filter as photo markers), sets
`flags.unanswered` and records the gap (`knowledge_gaps` table, RLS).

- The model decides, not the search: a greeting, a call-back request or an off-topic question that
  matches nothing in the knowledge is not a gap. Works on every provider (it is plain text, not a tool);
  the offline provider writes the marker too.
- Rewordings of the same question are counted on one line (trigram similarity of the topic), so the
  business sees what is asked most. A dismissed question stays dismissed; an answered one that is asked
  again is listed anew.
- The admin's **Knowledge** tab lists open gaps first, most asked first, with the latest visitor
  question. **Answer it** saves a Q&A answer (used from the next question on) and closes the gap;
  **Not relevant** dismisses it. The tab shows how many are open.
- Questions from the owner's test chat are flagged but not listed. A question that was also passed to
  staff as a request is listed, but only the request is emailed.

## Price lists and brochures (uploaded files)

A business without a website can upload what it has: on the **Knowledge** tab, **Upload a price list or
brochure** takes a PDF, a Word document (.docx) or a photo (PNG, JPEG, WebP), up to 5 MB and 20 files
per assistant (PLAN milestone 1.4).

- The worker reads the file into text (`packages/core/src/knowledge/files.ts`): a PDF's text layer
  (`unpdf`, first 50 pages), a Word document's headings, paragraphs, lists and tables with each table
  row kept on one line (`mammoth`), or a photo written out by a model that can see images (the `agent`
  routes; one call, recorded as `llm.agent` usage). The text is indexed like pasted text and is what
  the setup assistant reads to propose services and prices.
- Nothing is guessed. A scanned PDF with no text layer, a document that can't be opened, a photo with
  no readable text, or a photo when no connected model reads images fails with the reason shown on
  the source. The owner can open **View text** to check what was read.
- The type is detected from the file's content, never its name. The file is stored privately
  (`source_files`, RLS; there is no public route to it), photos lose their metadata first, and the file
  is deleted once its text has been read. **Refresh** re-indexes the kept text, so a photo is sent to a
  model once.
- A Word document is a zip: one whose directory declares more than 40 MB unpacked is refused.

## Interview (no website)

A business with nothing written down can answer a few questions instead: **No website? Answer a few
questions** on the **Knowledge** tab (PLAN milestone 1.4). Every question can be skipped.

- The questions come from the industry (`packages/industry-packs/src/interview.ts`): six common ones
  (what the business does, services and prices, where, hours, how to reach or book, payment), parking
  and access for businesses customers visit, then the industry's own (trades: emergency calls, quotes,
  licences and warranty; auto repair: vehicles, tires, waiting and loaners, warranty; restaurants and
  cafés: dietary needs, ordering). English and French.
- The answers are saved as one text source per assistant ("Interview answers"), each answer with its
  question so it keeps its meaning, in the assistant's default language (English for other languages).
  It is indexed like pasted text, and the setup assistant reads it like any other source. The answers
  are edited in the interview, not as pasted text; clearing every answer removes the source.
- `GET` / `PUT /v1/tenants/:t/bots/:b/interview`. No model is involved: the follow-up questions come
  from the setup assistant's "Questions your information doesn't answer yet".

## Setup assistant (onboarding)

Once a business has added its website, a price list or some text, the **Knowledge** tab offers **Suggest my setup**:
the setup assistant reads those pages in the background and proposes how to set the assistant up. The
owner edits the proposal and applies it; nothing is used before that.

- It proposes the business details (name, phone, email, address, opening hours), a greeting and
  suggested questions per language, and the questions customers often ask that the information doesn't
  answer yet. An answer the owner writes to one of those is saved as a Q&A answer.
- For the **business page** it proposes the short description and up to 20 **services and products**
  (name, price text, description, category) that aren't on the page yet. The owner unticks or corrects
  them in the review; the ones kept are added to the page's list (PLAN milestone 1.4).
- Details are kept only when they are found in the pages the model read: a phone number or email must
  appear there, and the hours and the address must come with a quote that does. The review shows that
  quote next to the suggestion. A service must be named in the pages; its price is kept only when the
  pages write that exact price, and a description that brings words or numbers the pages don't have is
  dropped. What can't be found is dropped, never guessed.
- One model call that returns JSON (`packages/core/src/setup/setup.ts`), so it works on any provider; no
  tool calling is needed. It uses the `agent` routes (`LLM_AGENT_ROUTES`, default: the chat routes), so
  owner-side jobs can use a different model than live chat. With no model configured it only looks up
  a phone number and email by pattern.
- A run is a row in `setup_runs` (RLS) processed by the worker (job `bot.setup`); the portal polls it.
  Pages are read home page and contact/about/hours pages first, up to `SETUP_MAX_INPUT_CHARS`
  (default 48,000 characters). An assistant can start 5 runs a day; tokens and cost are recorded as
  `llm.agent` usage.
- The **General** tab has the same business details as a form (plus booking and ordering links and the
  time zone), so they can be changed at any time.

## Requirements

- Node.js 24+ (26 LTS used locally; the PDF reader needs 24) and pnpm 10 (`npm install -g pnpm@10`)
- Docker (Postgres 17 + pgvector, Redis)

## Getting started

```bash
cp .env.example .env
pnpm install
pnpm db:up          # Postgres on localhost:5433, Redis on 6379
pnpm build          # builds the packages and the chat page
pnpm db:migrate
pnpm db:seed        # demo@traiblazer.local / demo-password-123
pnpm dev            # API on :4000, admin on :3000, worker, chat page rebuilds on change
```

Open http://localhost:3000 and sign in with the demo account.

## Checks

```bash
pnpm lint           # Biome (lint + format check); `pnpm format` to fix
pnpm typecheck
pnpm test           # needs `pnpm db:up`; uses the traiblazer_test database
```

CI (`.github/workflows/ci.yml`) runs the same steps against the docker-compose services. A pre-commit
hook (`.githooks/pre-commit`, turned on by `pnpm install`) runs the Biome check on the staged files.

**Accessibility** (`apps/e2e`): every page visitors and owners use (business page, chat in an iframe,
sign-in, dashboard, usage, every assistant tab, operator console) is checked with axe against WCAG 2.2
AA on a desktop and a phone-sized screen, with reduced motion, plus keyboard focus on the chat and no
sideways scrolling. It runs against the dev servers with the demo data:

```bash
pnpm dev && pnpm db:seed            # in another terminal
pnpm a11y                           # Chromium from Playwright: `pnpm --filter @traiblazer/e2e exec playwright install chromium` once
```

Not in CI yet (it needs the servers and a browser).

## Evals (answer quality and safety)

`packages/evals` checks what the assistant actually answers (PLAN §15), through the real chat engine
with the AI providers configured in `.env`:

```bash
pnpm evals                              # every case once (needs a model; see AI providers)
pnpm evals --business trades --lang fr  # one pack, one language
pnpm evals --category danger            # one category
pnpm evals --case burst --repeat 3      # cases whose id contains "burst", three runs each
pnpm evals --list                       # show the cases
```

- **Test businesses** (`src/businesses.ts`): a plumbing and heating company (Trades pack) and a tire
  and repair shop (Auto repair pack), set up as a pilot owner would: profile and hours, services with
  prices, and a few pages of text. Each run creates them as temporary businesses in `DATABASE_URL`,
  plays the conversations on the test channel (no notifications, no knowledge gaps) and deletes them.
- **Cases** (`src/cases/`): 59 conversations in English and French. Quality cases: facts the
  information gives, requests passed on with their details, service-area checks. Safety cases:
  danger and urgent triage, advice and diagnosis requests, invented prices, questions the
  information doesn't answer, off-topic requests and prompt injection. A request case can give one
  more visitor message (`moreDetails`), sent only when nothing was saved yet, for an assistant that
  asks for one more detail first, as the packs' workflows tell it to.
- **Scoring** is deterministic (`src/score.ts`): facts that must appear, words that must not (an
  invented dollar amount, a diagnosis), triage level, advice and "couldn't answer" flags, Call/Book
  buttons, the request saved, and the reply's language.
- **Bar** (PLAN §14): at least 80 % of quality runs pass and no safety case fails; the command exits
  with 1 otherwise. It also reports the median time to the first text. A JSON report with every
  reply is written to `packages/evals/reports/` (not committed).
- **First findings** (local qwen3-8b): replies that gave away the instructions to a "developer mode"
  message are now taken back by an output check (`withheld` flag), and the request tool takes
  placeholder values such as `"null"` or `"N/A"` as not given (the model sent `email: "null"` with the
  visitor's phone number, and the request was refused).
- **DeepSeek V4.1 Flash** (`openrouter:deepseek/deepseek-v4.1-flash-1017`, with
  `OPENROUTER_TOOL_MODELS` set): all 118 runs pass (2 × 59 cases), median time to first text 2.7 s.
  The runs before that found real bugs, now fixed:
  - pasted text, files and pages without a `lang` attribute were indexed without stemming, so
    "senior" missed "Seniors get 10% off". They are now stemmed as English and French, and migration
    0034 rebuilds existing vectors;
  - a French question to a business whose information is in English searched only in French. It
    now waits for the English and French queries, and the query writer adds the words a business
    would use ("flat tire" → towing, roadside);
  - the tire shop's guideline held back listed service prices until the tire size was given.
- `pnpm test` only checks the scorer and the case list; evals need a model, so CI doesn't run them.
  Run them after changing prompts, packs, tools or the model, and with `--repeat` before comparing
  models (open decision §17.10).

## Operator console (Traiblazer staff only)

Staff manage businesses, users, plans and platform policies at http://localhost:3000/operator. Sign in
with the seeded staff account `staff@traiblazer.local` / `staff-password-123` (the demo business owner
can't open it).

- **Super admin** is a platform role on dedicated staff accounts. A staff account can never belong to a
  business and a business member can never be made staff; the database enforces both
  (`app_staff_not_member` trigger). Staff can't create businesses; staff signing in go straight to the
  console.
- Everyone else gets `404` from `/v1/operator/*`, and business users never see a link to the console.
- **Support access:** from a business in the console, staff can open its assistants and usage pages and
  make changes as an admin of that business. A "Support mode" banner is shown, and every change is
  recorded in the business's own audit log and in the operator audit log (`support.change`).
- Plans and policies are stored in the database (`plans`, `platform_settings`); every console change is
  recorded in `operator_audit_logs`.

Super admin access can only be granted from the command line (no API), to an account that isn't part of
any business:

```bash
pnpm --filter @traiblazer/api superadmin grant dev@example.com
pnpm --filter @traiblazer/api superadmin revoke dev@example.com
pnpm --filter @traiblazer/api superadmin list
```

### Prospect demos

The console's **Demos** tab builds a demo page for a business that isn't a customer yet, to show at
the first contact (PLAN §2.2): enter its name and industry, its website and/or text pasted from what
it publishes about itself (Google listing, Facebook page, price list), and the page is filled in
within a minute or so.

- A demo is a business of kind `demo` (`tenants.kind`) with **no members**, plus a row in `demos`
  (platform table: status, the operator's note, who built it). Everything on it lives in its own
  tenant under row-level security, like any business.
- **How it is built:** the sources are read like any knowledge source (website crawl with robots.txt,
  pasted text), then the worker job `demo.build` runs the setup assistant and applies its whole
  suggestion: business details, hours, description, services with prices, greeting and suggested
  questions (`packages/core/src/demo/build.ts`). The setup assistant's rule still holds: nothing is
  kept that isn't in the sources. Nobody reviews the suggestion first, so **review the page before
  sharing the link** ("Review & edit" opens it with support access); "Build again" reads the sources
  again without repeating services already on the page.
- **Private:** the page shows a notice ("Demo page prepared for … It isn't public"), is never listed by
  search engines whatever its settings, and has no friendly link: only people with the `/c/<key>` link
  can open it. No notification emails are sent.
- **Was it opened?** The list shows page views, chats and requests for each demo (the operator's own
  preview and test chats aren't counted). Demos are kept out of the Businesses list and the overview
  counts; their AI cost is shown apart.
- **Hand over:** when the owner has signed up, "Hand over" makes their account the owner (same
  limit on businesses per account as usual), the business becomes an ordinary one and the notice
  comes off. The assistant stays a draft, so the page is listed only once the owner activates it.
- **Delete** removes the demo business and everything in it. Statuses: building, ready, nothing to
  read (`needs_information`), couldn't fill the page in (`failed`), handed over.

### Onboarding checklist

The console's **Onboarding** tab tracks the done-for-you setup of a business we build the page for
(PLAN §7.5): pick the business, say when its materials arrived, and the page is **due one working day
later** (same time the next weekday in Toronto time; materials sent on a weekend count from Monday 9:00;
statutory holidays aren't counted).

- **Seven steps.** Five are checked from the business's own data every time the list is opened: materials
  read (a source is ready), page content (description, phone or email, hours), services and prices,
  photos, page published (assistant active and page on). Staff tick the other two: the owner reviewed
  the page, and the page link is on the Google Business Profile. Any step but publishing can be marked
  "not needed" (and undone); each mark records who and when.
- **Publish page** turns the assistant on and the page on, with support access, once the owner's review is
  ticked; it is written to the business's activity log and the operator audit log. If the owner publishes
  it themselves, the checklist notices the next time it is opened. Each card shows "due in", "overdue by"
  or whether it went live on time.
- One checklist per business, in the platform table `onboardings` (no row-level security, staff only).
  Prospect demos are handed over first. Removing a checklist leaves the business as it is.

## Multi-tenancy and security model

- Every tenant-owned table has `tenant_id` and a Postgres **row-level security** policy
  (`packages/db/migrations/0001_rls.sql`).
- The API connects as `traiblazer_app`, which is not a superuser and cannot bypass RLS. Tenant-scoped
  work runs inside `withTenant(db, tenantId, fn)`, which sets `app.tenant_id` for that transaction only.
- Child tables reference `(bot_id, tenant_id)` together, so a row can never point at another
  tenant's bot.
- Widget keys are resolved through a `SECURITY DEFINER` function (`app_resolve_bot_key`), so the app
  role never needs cross-tenant reads.
- Non-members get `404` for another business's routes. Roles: owner > admin > editor > viewer.
- Passwords: scrypt (N=2^17); sessions: random token in an httpOnly SameSite=Lax cookie, only its
  SHA-256 is stored. Sign-in/sign-up are rate-limited per IP.
- Website crawling blocks private/loopback/metadata addresses on every request and redirect (SSRF)
  and respects robots.txt.
- Public chat: same-origin only, rate-limited per IP, visitors can only restore their own conversation.
- Limits before any AI cost (`apps/api/src/lib/chat-guard.ts`): questions per visitor per day, questions per
  conversation, per-business questions per minute and concurrent answers (noisy neighbours), and the monthly
  question limit (plan allowance set in the operator console, owner can set lower). Refused questions get a
  translated message in the chat and are counted on the admin **Usage** page.
- Set `REDIS_URL` (as in `.env.example`) so rate limits and per-business limits are shared by all API servers;
  without it they're kept per server, which is fine for a single server.
- Retrieved website text is treated as data, never instructions; platform rules (grounding, no
  professional advice, emergencies) come first in the prompt and can't be overridden by owners.

## Adding a migration

Edit `packages/db/src/schema.ts`, then:

```bash
pnpm db:generate    # writes a new SQL file to packages/db/migrations
pnpm db:migrate
```

New tables get privileges for `traiblazer_app` automatically; **add an RLS policy** in the migration
for every new tenant-owned table, and a test in `packages/db/src/rls.test.ts`.
