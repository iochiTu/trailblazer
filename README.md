# Traiblazer

Multi-tenant AI assistant (chatbot / RAG) platform for small businesses. See [docs/PLAN.md](docs/PLAN.md)
for the product plan and roadmap.

**Status:** Phase 1, milestone 1.1 (chat end-to-end) — knowledge sources (website crawl, text, Q&A),
retrieval, streaming answers with sources, multi-provider LLM gateway, and three ways to put the chat
on a customer's site: hosted chat page, inline iframe, floating widget. See PLAN.md §14 for what's next.

## Layout

```
apps/
  api/              Fastify API: auth, tenants, bots, knowledge, public chat, chat page + widget.js
  admin/            Next.js admin portal (EN/FR): knowledge, test chat, share & install, conversations
  chat/             Preact chat page (hosted link / iframe / widget panel) + widget.js loader
  worker/           Background jobs: website crawling and indexing
packages/
  core/             Chat engine, retrieval, prompt (locked platform rules), crawler, job queue
  llm/              LLM gateway: Claude (Anthropic SDK), OpenAI-compatible (OpenRouter…), offline provider
  db/               Drizzle schema, migrations (incl. row-level security), withTenant()
  i18n/             Language registry (tiers, RTL), UI messages (ICU), language negotiation
  industry-packs/   Industry catalog + templates (response guidelines, suggested questions, workflows)
  shared/           Zod request schemas shared by API and admin
infra/postgres/     Local database init (roles, test database)
```

## Chat surfaces

| Surface | What the business uses |
|---|---|
| Hosted chat page | `http://localhost:4000/c/<public-key>` — a link to share anywhere (QR codes, social media) |
| Inline iframe | `<iframe src="http://localhost:4000/c/<public-key>?embed=inline">` inside one of their pages |
| Floating widget | `<script src="http://localhost:4000/widget.js" data-bot="<public-key>" async></script>` |

All three load the same chat page. It is served with `frame-ancestors` limited to the bot's allowed
websites (plus the admin portal), and talks to the API on its own origin. The admin's
**Share & install** tab shows the ready-to-copy codes.

## AI providers

Without API keys, chat uses an **offline test provider** that quotes matching sentences from the
business's information, so everything works locally at no cost. Set `ANTHROPIC_API_KEY` (and/or
`OPENROUTER_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL`) in `.env` for real answers; see `.env.example`.
With an Anthropic key the default routes are `claude-opus-5-5` for answers (low effort, server-side
refusal fallback enabled) and `claude-haiku-5-5` for query rewriting/translation.

## Requirements

- Node.js 22.12+ (26 LTS used locally) and pnpm 10 (`npm install -g pnpm@10`)
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

CI (`.github/workflows/ci.yml`) runs the same steps against the docker-compose services.

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
