# Facebook Messenger answering: design

Status: planned (November 2026), nothing built. Related: [WHATSAPP.md](WHATSAPP.md) (shares the
message handler and the per-channel send queue), [PHONE_AND_SMS.md](PHONE_AND_SMS.md) (the SMS path
both build on), PLAN §7.3, §12 (consent), §13 (channels via interfaces), §14 (roadmap). Meta rules
below are from memory and marked *(verify)* where they must be confirmed before they are relied on.

## 1. Goal

Customers write to the business's Facebook Page on Messenger and get the same assistant, knowledge,
requests and photos as on the web chat. The owner sees those conversations in Conversations, and the
assistant steps back when the owner answers by hand.

## 2. How it differs from SMS and WhatsApp

- **Identity:** Messenger has no phone number. Each business connects its **Facebook Page**, and each
  customer is identified by a Page-scoped ID (PSID).
- **Connection:** directly through Meta's Graph API, not Twilio. Webhooks arrive as JSON; replies go
  out through Meta's Send API.

What is reused:

- **Connecting the page:** the CRMs' OAuth start and callback (`apps/api/src/routes/integrations.ts`),
  with its signed state and admin check.
- **Storing the page token:** `seal` in `packages/integrations/src/crypto.ts`.
- **Answering:** the shared message handler from the WhatsApp plan, and the `message.send` queue.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Provider | Meta's Graph API directly, in a new `packages/meta` with no SDK | No middleman is needed; the same client can later serve Instagram DMs and WhatsApp through Meta |
| Customer identity | PSID as `visitorId`, `channel: "messenger"` | It is all Messenger gives us; no phone number |
| Requests | The assistant asks for contact details, like the web chat | There is no phone number to attach |
| Buttons | QUOTE / BOOK markers become quick replies; the booking link becomes a URL button | Messenger has real buttons, better than SMS's "Reply QUOTE" |
| Owner replies in Meta's inbox | The assistant goes quiet in that thread for 12 hours (a setting) | It must not talk over a person |
| Messages that start a conversation | None; replies only, inside the 24-hour window | No message tags or sponsored messages |
| Cost | No per-message cost from Meta; AI use limited by `admitQuestion` | The phone's daily spend cap doesn't apply |

## 4. Phases

### Phase 0 — Meta app and approval (no code, starts now; the long wait)

- One Meta app for the platform. Business verification of **our** company.
- *(verify)* **App Review** for `pages_messaging`, `pages_manage_metadata` and `pages_show_list`, with
  a screencast and a privacy policy; approval can take weeks.
- Before approval the app works only on pages owned by people with a role on the app — enough to
  build and test against our own test Page.

### Phase 1 — Meta client and data

- **`packages/meta`:** a small Graph API client that can:
  - check the webhook signature (`X-Hub-Signature-256`, HMAC-SHA256 of the **raw body** with the app
    secret)
  - parse webhook events
  - send a message (text, quick replies, buttons)
  - subscribe a page to our webhooks
  - list the user's pages
  - download customer photos, from Meta's own hosts only

  A fake provider for tests. Config: `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`,
  `META_GRAPH_VERSION`.
- **`packages/db`** (migration):
  - `"messenger"` in `channels` and `itemStatSurfaces`.
  - New table `messenger_pages`: tenant, bot, `page_id` (unique across the platform), page name,
    sealed page token, `enabled`, `status` (`connected` / `error`), pause hours; row-level security.
  - `app_resolve_messenger_page`, which finds a page without a tenant context, like
    `app_resolve_phone_number`.
  - `outbound_messages.channel` (shared with the WhatsApp plan); from/to hold the page ID and the PSID.

### Phase 2 — connecting a page (portal)

- **Connect Facebook Page** on a new Messenger card in the bot's Add-ons tab, through the existing
  OAuth start and callback with a new `facebook` connector in the integrations registry.
- After sign-in the owner **picks a page** from the ones they manage. We swap their token for a
  long-lived page token, seal it, store the page, and subscribe the app to the page's `messages`,
  `messaging_postbacks` and `message_echoes` events.
- **Disconnect** unsubscribes the page and deletes its token. A token Meta rejects marks the page
  `error`, and the owner is told to reconnect, as for CRM connections.

### Phase 3 — answering

- **Webhook routes:**
  - `GET /v1/meta/webhook`: answers Meta's verification check (`hub.verify_token`, `hub.challenge`).
  - `POST /v1/meta/webhook`: checks the signature against the raw body (its own body parser). One
    request can carry several events; each is handled on its own. Acknowledged at once, answered
    after; a repeated delivery is handled once (by `mid`).
- **The handler** (`medium: "messenger"`):
  - **Conversation:** `channel: "messenger"`, keyed by PSID, same 24-hour thread window.
  - **Requests:** no phone number, so contact details are asked for; `visitorPhone` stays unset in
    `packages/core/src/chat/engine.ts`.
  - **Reply format:** plain text (Messenger shows no Markdown), at most 2,000 characters.
  - **Buttons:** quick replies for QUOTE / BOOK and a URL button for the booking link; a tap returns
    a payload the handler already understands.
  - **Prompt:** a Messenger section in `packages/core/src/chat/prompt.ts` — plain text, short,
    buttons allowed.
- **Photos:** image attachments go through `prepareChatImage` under the chat's limits. Audio, video,
  files and stickers get a short answer; the 👍 "like" gets none.
- **The owner replies in Meta's inbox:** an echo event (`is_echo`, sent by someone other than our
  app) pauses the assistant in that thread for the page's pause hours (12 by default).

### Phase 4 — sending

- The worker's `message.send` job chooses by channel: Twilio for `sms` and `whatsapp`, Meta's Send API
  for `messenger`.
- A customer who blocked the page, or an invalid token, is a permanent failure; an invalid token also
  marks the page `error`.

### Phase 5 — portal and business page

- **Messenger card:** the connected page's name, an on/off switch, the status, the pause setting.
- **Share tab:** an `m.me/<page>` link and QR code.
- **Business page:** a "Message on Messenger" button when a page is connected.
- **Conversations and Insights:** a Messenger label and filter; a "paused: the business replied"
  marker on threads.
- EN/FR strings; passes the `pnpm a11y` checks.

### Phase 6 — tests, evals, docs

- Unit tests: the signature check on the raw body, several events in one delivery, echoes and the
  pause, the reply format and buttons, the page-connection flow (fake Graph API), token failure.
- `packages/evals/src/cases/messenger.ts`: the SMS cases changed to ask for contact details and to
  expect buttons.
- README and PLAN §14 updated; "Phase 1 as built" added here.

## 5. Later

- Instagram DMs (same API and webhook, little extra work).
- The Get Started button and preset questions (ice breakers).
- Sending gallery photos.
- Meta's handover protocol for businesses that use another inbox tool.

## 6. Compared with WhatsApp

Messenger needs more new code: the Meta client, page connection in the portal, and the pause when
the owner replies. It has no per-message cost and better buttons. The two share the message handler
and the per-channel send queue, so whichever is built second is cheaper. Meta's App Review should
start now either way.

## 7. Open questions

1. *(verify)* The exact permissions and access level App Review grants for a platform serving many
   businesses' pages.
2. The default pause after the owner replies (12 hours proposed), and whether the owner can resume the
   assistant by hand.
3. Whether Messenger is part of an add-on or included in every plan.
