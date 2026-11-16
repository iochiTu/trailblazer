# WhatsApp answering: design

Status: planned (November 2026), nothing built. Related: [PHONE_AND_SMS.md](PHONE_AND_SMS.md) (the
SMS path this reuses), [MESSENGER.md](MESSENGER.md) (shares the message handler and send queue), PLAN §7.3 (phone and SMS flows), §12 (consent), §13 (channels via interfaces),
§14 (roadmap; WhatsApp is listed in phase 4). Meta and Twilio rules below are from memory and marked
*(verify)* where they must be confirmed with Twilio before they are relied on.

## 1. Goal

Customers write to the business's number on WhatsApp and get the same assistant, knowledge, requests
and photos as by text. The owner sees those conversations next to the SMS and web ones.

- **One engine.** WhatsApp is one more value of `channel`; it runs `runChat` like SMS does.
- **Reuse the SMS path.** Twilio sends WhatsApp to the same kind of webhook (form fields, same
  signature) and sends replies through the same Messages API. The only visible difference is that
  addresses read `whatsapp:+1…`.
- **Replies only.** Every message we send answers one from the customer, inside Meta's 24-hour
  window. Messages that start a conversation (templates) are out of scope for now.

## 2. A problem to fix first

`toE164("whatsapp:+18075550142")` in `packages/telephony/src/numbers.ts` drops the prefix and returns
`+18075550142`. If Twilio's WhatsApp webhook were pointed at `/sms` today, the message would be
handled as an SMS and the reply sent as a normal text. Parsing must recognise the prefix explicitly.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Provider | Twilio, behind `packages/telephony` | Already integrated; WhatsApp uses the same API and webhook format. Meta's Cloud API directly is the fallback if Twilio's fees or the onboarding don't work out |
| Sender number | The business's **existing SMS number** | One number for texts and WhatsApp; `phone_numbers` already maps it to the assistant |
| Webhook | A separate route, `POST /v1/telephony/twilio/whatsapp` | Each Twilio setting points at one place; no guessing from the prefix |
| Threads | `channel: "whatsapp"`, separate from `sms`, same 24-hour window | A WhatsApp conversation and an SMS one from the same person are different threads |
| Opt-out | STOP / START / HELP as for SMS, stored per channel | WhatsApp has no carrier-level opt-out, so ours is the only one; a STOP on one channel doesn't silence the other |
| Messages that start a conversation | Stay on SMS (missed-call text-back, owner alerts, reminders) | They need Meta-approved templates; later phase |

## 4. Phases

### Phase 0 — accounts and approval (no code, starts now)

- Meta business verification for each business, and a WhatsApp sender with an approved display name.
- *(verify)* A platform signing up businesses on their behalf usually has to join Meta's Tech
  Provider program and use Twilio's in-app sign-up flow (Embedded Signup). For the first pilots,
  staff register senders by hand in Twilio's console, the same way numbers are entered today.
- *(verify)* Meta doesn't charge for replies inside the 24-hour window; Twilio charges a small fee per
  message.

### Phase 1 — provider and data

- **`packages/telephony`:** `medium: "sms" | "whatsapp"` on `InboundMessage` and `SendMessageInput`.
  Twilio parses and strips the `whatsapp:` prefix, adds it back when sending, and skips SMS segment
  counting for WhatsApp. The fake provider learns WhatsApp too.
- **`packages/db`** (migration 0054):
  - `"whatsapp"` in `channels` and `itemStatSurfaces`.
  - `phone_numbers.whatsapp_enabled` and `whatsapp_status` (`off` / `pending` / `approved`).
  - `channel` on `outbound_messages` and `sms_opt_outs`.
  - `resolvePhoneNumber` returns `whatsappEnabled`.

### Phase 2 — answering

- **Webhook** (`apps/api/src/routes/telephony.ts`): the new route with the same signature check,
  duplicate check, and `admitQuestion` / `admitImages` limits; acknowledged at once, answered after.
- **Core:** `handleInboundText` in `packages/core/src/sms/sms.ts` becomes a shared handler with a
  `medium` setting. What changes with the medium:
  - **Conversation:** `channel: "whatsapp"`.
  - **Reply format:** a new `toWhatsAppText`: *bold* and _italics_ in WhatsApp's own style, links
    written out, at most 1,600 characters (Twilio's maximum); no 7-bit character trimming.
  - **Prompt:** a WhatsApp section in `packages/core/src/chat/prompt.ts`, based on `SMS_RULES` with
    light formatting allowed.
  - **Engine** (`packages/core/src/chat/engine.ts`): requests carry the sender's number as for SMS;
    gallery photos stay off for now.
- **Photos:** `fetchMedia` already works for Twilio's WhatsApp media. Voice notes (`audio/ogg`) get
  the same one-line answer as a video.
- **Usage and cost:** usage kind `whatsapp`, counted toward the number's daily spend cap.

### Phase 3 — Meta's 24-hour rule

Replies always answer a customer message, so they stay inside the window. Nothing else is sent on
WhatsApp in this phase; text-back, alerts and reminders stay on SMS.

### Phase 4 — portal and business page

- **Phone & texts tab** (`apps/admin/src/components/bot/PhoneTab.tsx`): a WhatsApp switch and its
  approval status. Staff see the WhatsApp webhook address and the switch that marks a sender approved.
- **Share tab:** a `wa.me/<number>` link and QR code (the existing `QrCode` component).
- **Business page:** a "Message on WhatsApp" button next to Call, Book, Email and Directions when the
  sender is approved.
- **Conversations and Insights:** a WhatsApp label and filter; insights by channel come for free.
- EN/FR strings; passes the `pnpm a11y` checks.

### Phase 5 — tests, evals, docs

- Unit tests: parsing and prefix handling, separate opt-outs and threads, the reply format.
- `packages/evals/src/cases/whatsapp.ts`: the 20 SMS cases plus formatting checks.
- README and PLAN §14 updated; "Phase 1 as built" added here.

## 5. Later

- WhatsApp's own quick-reply buttons for "QUOTE" and "BOOK".
- Sending gallery photos.
- Template messages for owner alerts, missed-call text-back and reminders.
- Embedded Signup so businesses connect WhatsApp themselves.

## 6. Open questions

1. Twilio's terms for platforms registering senders for many businesses (Tech Provider program,
   Embedded Signup) — confirm in phase 0.
2. Whether some businesses want a WhatsApp-only number instead of their SMS number.
3. Whether WhatsApp should be part of the phone add-on or priced on its own.
