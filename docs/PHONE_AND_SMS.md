# Phone reception and SMS answering: design

Status: phase 1 partly built (November 2026): texts in and out and missed-call text-back work in
tests and against the real model, not yet against a live Twilio number. See "Phase 1 as built". Related: PLAN §7.3 (flows), §8.3
(where it runs), §9.3 (turns), §12 (CASL, CRTC, recording), §18.4 (rules for institutions).

PLAN §7.3 already describes what the caller and the owner experience. This document decides **how to
build it**: which provider, which voice pipeline, in what order, and what has to be measured first.
Prices, product names and carrier rules below were checked on the web in November 2026, mostly from
third-party pages; each one marked *(verify)* must be confirmed with the provider before it is relied
on.

## 1. Goal and constraints

A business keeps its number and forwards the calls it can't take. The assistant answers the phone and
texts, from the same knowledge, rules and tools as the web chat, and the owner hears about every call.

- **One engine.** A phone answer and a chat answer to the same question agree, and the same evals
  cover both. No second "brain" with its own copy of the rules.
- **Fast enough to talk to.** The caller hears the first words within about one second of finishing
  a sentence (PLAN §7.3). Today's chat answers start at about 1.3 s; voice needs better.
- **Never silence.** Any failure ends in voicemail plus a text-back, and an urgent call always
  reaches a person or the on-call list.
- **Provider-neutral.** Telephony and voice sit behind our own interfaces, like the LLM gateway, so
  the carrier, the speech services and the model can each be changed (PLAN §3, §18.4).
- **Lawful by construction.** Replies and transactional texts only; no cold texts, no AI sales calls;
  the greeting says it is automated and recorded (PLAN §12).
- **Bounded cost.** Per-business caps on call length, simultaneous calls and daily spend; every
  minute and message metered.

## 2. What exists today, and the gaps

| Area | Built | Gap |
|---|---|---|
| Engine | `runChat`: retrieval, triage, scope rules, tools (search, request, service area), markers, usage metering | Channels are `hosted`, `inline`, `widget`, `playground`. No `sms` or `voice`; replies are written for a screen (Markdown, buttons, photos) |
| Conversations | Keyed by a browser `visitor_id`; history of 10 turns | A caller or texter is a phone number; an SMS thread has no "session end" |
| Requests and alerts | Leads, urgent flag, urgent email, notification add-on | Alerts go by email only; no text to the owner, no call transfer |
| Jobs | Postgres job queue with priorities and retries in `apps/worker` | No outbound message job, no delivery-status handling |
| Limits | Per-business rate and concurrency limits | Nothing per phone number, per call, or in dollars per day |
| Speed | Median first text 1.3 s (DeepSeek V4.1 Flash; EMBEDDINGS §7) | Too slow for a call once speech recognition and speech synthesis are added |
| Telephony | Nothing | Numbers, webhooks, signatures, forwarding, recordings |

## 3. Decisions

### 3.1 Telephony provider: Twilio, behind `packages/telephony`

Twilio for numbers, SMS/MMS and calls: Canadian local numbers in every area code, mature webhooks,
call-status callbacks (needed for missed-call text-back), recording, transfer, and its own speech
layer (ConversationRelay). Telnyx is the alternative if price or Canadian routing requires it. All
Twilio-specific code lives in one adapter:

```ts
interface TelephonyProvider {
  verifyWebhook(request): boolean;                 // signature check
  sendMessage({ from, to, text, mediaUrls? }): Promise<{ id: string }>;
  parseInboundMessage(body): InboundMessage;       // from, to, text, media, STOP/HELP keyword
  parseCallEvent(body): CallEvent;                 // ringing, answered, completed, no-answer…
  callControl: { answerWith(...), transfer(to), hangUp(), voicemail() };
  numbers: { search(areaCode), buy(number), release(number) };
}
```

### 3.2 Order: SMS first, then voice

SMS needs no speech at all, reuses the engine unchanged, and missed-call text-back is the feature
pilots can use the day it ships. Voice follows on the same numbers.

### 3.3 Voice pipeline: decide by measurement

Two ways to put the assistant on a call. Both use Twilio for the call itself.

| | **A. Speech-to-speech** (Twilio → OpenAI Realtime) | **B. Speech layer + our engine** (Twilio ConversationRelay → `runChat`) |
|---|---|---|
| How | Call audio goes to one model that listens, thinks and speaks (SIP or media stream) | Twilio transcribes the caller and speaks our reply; `apps/voice` receives text turns and streams text back |
| Feel | Fastest and most natural; handles interruptions and tone | Good; depends on our engine's speed. Expect 1–1.5 s unless the voice profile gets faster |
| Grounding and safety | The model is the brain. Knowledge search, triage, scope rules, requests and service buttons must be re-expressed as its instructions and tools: a second implementation to keep in step and to evaluate | The existing engine, unchanged: same retrieval, triage, scope guard, tools and evals as chat |
| Model choice | OpenAI only | Any model in the gateway |
| Data location | Audio processed by OpenAI *(verify regions)* | Model can be Canadian-hosted or self-hosted; speech still goes through Twilio *(verify regions)* |
| Cost per minute | Roughly 15–25¢ for the model, plus the call *(third-party estimates; verify)* | A bundled speech charge plus a text model at a fraction of a cent per turn *(rate not confirmed; verify)* |
| Risk | Lock-in; price and model names changed twice in a year | Latency |

**Recommendation:** build B as the default, because it keeps one engine, any model and a path to
Canadian data handling (§18). Keep A as a second backend behind the same interface, and choose per
deployment only after the test in §6: if B can't get under about 1.2 s to first words, or callers
talk over it badly, A becomes the default for small businesses and B stays for institutions.

```ts
/** What apps/voice needs from a voice backend; ConversationRelay and Realtime both fit. */
interface VoiceSession {
  onCallerTurn(handler: (text: string, meta: { language?: string; interrupted: boolean }) => void): void;
  say(textStream: AsyncIterable<string>): Promise<void>;   // speak as text arrives
  transfer(to: string): Promise<void>;
  end(reason: "done" | "voicemail" | "error"): Promise<void>;
}
```

With backend A the engine is exposed to the model as tools (`answer_from_business_info`,
`request_follow_up`, `transfer_call`, `send_text`), so facts still come only from our retrieval.

## 4. Architecture

```
 SMS / MMS                                         CALLS
 ─────────                                         ─────
 customer ──▶ Twilio ──▶ POST /v1/telephony/sms    caller ──▶ business number ──(forward)──▶ Twilio number
              (signed)        apps/api                                   │
                │ find assistant by number                    POST /v1/telephony/voice (apps/api)
                │ STOP / HELP handled here                       │ limits ok?  hours?  mode?
                ▼                                                ├─ text-back only ──▶ hang up, queue SMS
        runChat(channel "sms")                                   └─ answer ──▶ connect to apps/voice
                │                                                               │ VoiceSession (A or B)
                ▼                                                               ▼
        job "message.send" ──▶ apps/worker ──▶ Twilio              runChat(channel "voice", fast profile)
                                                                    tools: search, request, transfer_call,
 call ended / not answered ──▶ status webhook                              send_text
        └─ missed? ──▶ job "message.send" (text-back)               after: summary, transcript, recording,
                                                                           owner alert (text or email)
```

### 4.1 Numbers and forwarding

- One local number per assistant, in the business's area code, bought through the adapter; stored in
  a new `phone_numbers` table (tenant, assistant, number, capabilities, status, registration state).
- The business forwards unanswered, busy or after-hours calls (or all calls) to it. Setup is a
  per-carrier instruction sheet ending in a test call the portal can see ("we received your test
  call").
- The assistant is found by the number that was called or texted. An unknown or released number
  answers with a neutral message and logs it.

### 4.2 SMS and MMS

- **Inbound:** verify the signature; look up the assistant; handle `STOP`, `START`, `HELP` (and the
  French `ARRET`, `AIDE`) before the engine and record opt-outs in `sms_opt_outs`; then `runChat` with
  `channel: "sms"` and the sender's number as the visitor.
- **Conversation:** one open thread per customer number and assistant; a new one after 24 hours of
  silence, so an old topic doesn't colour a new question.
- **Reply shape** (prompt block per channel): plain text, no Markdown, about 300 characters where
  possible, split at sentence ends above 480; links allowed. Buttons become text: a Call button is the
  phone number, a Book button the link, a service's quote button the sentence "Reply QUOTE to ask for
  a quote for …". Photos from the knowledge base go as MMS only when asked for.
- **Photos in:** MMS images are stored like chat attachments and attached to the request.
- **Outbound:** every text is a job (`message.send`) with retries and delivery status; the first
  message of a thread carries the business name and "Reply STOP to opt out".
- **Missed-call text-back:** the call-status webhook reports a forwarded call that ended unanswered
  or was set to text-back only; one text within seconds, at most once per caller per day.

### 4.3 Voice

- **`apps/voice`**, a separate deployable (PLAN §8.3): holds the live sessions, drains calls before
  shutting down, scales with simultaneous calls. `apps/api` only answers Twilio's first webhook and
  hands the call over.
- **A call:** greeting with the disclosure, in the business's main language, with "pour le français,
  dites français" → caller turns → `runChat` with `channel: "voice"` → reply streamed sentence by
  sentence to speech.
- **Fast voice profile** (a third gateway purpose next to `chat` and `aux`): a model whose first
  token arrives in about 300 ms, no thinking, short answers. The query-rewrite call is skipped on the
  first turn and runs alongside later, as chat already does; retrieval uses the question's vector
  (EMBEDDINGS), which the local backend returns in 3 ms.
- **Latency budget for backend B:** end of speech detected ~300 ms → engine first sentence ~500 ms →
  speech starts ~200 ms: about one second. A filler ("One moment…") is spoken when a tool runs longer
  than a second.
- **Reply shape:** short spoken sentences; no Markdown, lists or links; numbers, times and addresses
  written the way they are said; anything to click is sent by text ("I'll text you the booking link").
- **Voice-only tools:** `transfer_call` (to the business during opening hours, or the on-call list)
  and `send_text` (a link, or a request for a photo).
- **"Talk to a person"** always works: transfer when open, a callback request otherwise.
- **Emergency:** the existing triage decides. Danger → the safety message first, then transfer;
  urgent → transfer to the on-call list, each number rung in turn; nobody answers → urgent text and
  email to the owners and an urgent request, as today.
- **Failure:** speech service down, model error or `apps/voice` unreachable → Twilio falls back to a
  recorded voicemail greeting, and the caller gets a text-back.
- **After the call:** transcript and summary (who, what, how urgent, what was promised) stored on the
  conversation; recording stored when the business has recording on; the owner gets a text or email
  with a link.

### 4.4 For the owner

- **Phone settings** (assistant → new Phone tab): number, forwarding instructions and test call,
  mode per time of day (answer, text-back only, off), greeting, on-call list, transfer number,
  recording on or off, alert by text or email.
- **Conversations:** calls and SMS threads appear with the web chats, marked by channel, with the
  transcript, the recording and the request they produced.
- **Usage:** minutes and messages per day next to AI usage; the daily spend cap and what happens at
  the cap (text-back only).

## 5. Data model

| Change | Purpose |
|---|---|
| `channels` gains `sms` and `voice` | One engine, replies shaped per channel |
| New `phone_numbers` (tenant, bot, e164, provider id, capabilities, status, registration state) | Which assistant a number belongs to |
| New `phone_settings` on the assistant (mode schedule, greeting, on-call list, transfer number, recording, alert channel, caps) | Owner settings |
| New `calls` (tenant, bot, conversation, from, to, started, ended, duration, outcome, recording asset, cost) | Call log and metering |
| New `outbound_messages` (tenant, bot, conversation, to, text, status, provider id, error, segments) | Delivery status, retries, metering |
| New `sms_opt_outs` (tenant, bot, number, at) | STOP is remembered per assistant |
| `conversations.visitor_id` holds the caller's number for these channels, stored in E.164 | A returning caller keeps their thread |
| `usage_events` kinds `sms`, `mms`, `voice.minute`, `voice.speech` | Cost per business |

Every table has `tenant_id` and RLS, a created-at index, and is covered by export and deletion
(PLAN §18.4). Recordings and transcripts follow the business's retention period.

## 6. The voice test (before building voice)

Three days, one Twilio number, two thin prototypes behind `VoiceSession`.

| Measure | How | Bar |
|---|---|---|
| Time to first words | 20 scripted calls per backend (10 EN, 10 FR), from end of caller speech to start of reply | Median ≤ 1.2 s, 95th percentile ≤ 2 s |
| Correctness | The existing eval questions, asked aloud | Same answers as chat; no invented price |
| Interruptions | Caller talks over the reply in 5 calls | Stops within half a second, keeps the thread |
| French | Quebec and Franco-Ontarian accents, mixed-language callers | Understood without repeating |
| Cost | Provider invoices for the test calls | Recorded per minute, per backend |
| Triage | Burst pipe, gas smell, "talk to a person" | Right path every time |

The result goes into §3.3 and sets the default backend. Until then nothing in voice v1 is built.

## 7. Compliance and registration

- **Sender registration** *(verify with Twilio before phase 1; approval can take weeks)*: sources
  disagree on what Canadian carriers require of local numbers. Twilio's guidance recommends verified
  toll-free numbers or short codes for business texting; one source says local numbers bought after
  March 2025 need registration or identity verification even for Canada-only traffic; texts to US
  numbers need A2P 10DLC registration in every case. Start registration at the beginning of phase 1.
- **CASL:** replies to a customer who wrote or called first, and transactional messages. The
  missed-call text is a reply to the call. No marketing texts without recorded consent; STOP honoured
  per assistant.
- **CRTC:** no outbound AI sales calls. Outbound calls are callbacks the customer asked for and
  emergency calls to the business's own on-call contacts.
- **Recording and disclosure:** the greeting says it is an automated assistant, and that the call is
  recorded when recording is on. Recording is a per-business setting, off by default until the
  business confirms it.
- **911:** the assistant never claims to dispatch help; a danger gets the safety message ("hang up and
  call 911") before anything else, as in chat.
- **Institutions (§18):** where audio and transcripts are processed is the open question for both
  backends; a Canada-only voice path is not promised until the providers' regions are confirmed.

## 8. Cost and limits

- Per business: maximum call length (default 10 minutes, with a spoken warning), simultaneous calls
  by plan, daily spend cap; at the cap the number switches to text-back only and the owner is told.
- Per customer number: messages per day; one text-back per day.
- Metering: every message segment and call minute becomes a usage event with its cost, shown in the
  operator console next to AI cost.
- Pricing to customers (included minutes and texts, overage) waits for the measured cost in §6.

## 9. Phases

| Phase | Work | Size |
|---|---|---|
| **0. Registration** | Twilio account, sender registration or toll-free verification, legal check of the greeting and text wording | Starts now; waits on the provider |
| **1. SMS and missed-call text-back** (partly built) | `packages/telephony` with the Twilio adapter; number purchase; inbound and status webhooks; `sms` channel and reply shape; STOP/HELP; `message.send` job; Phone tab (number, forwarding sheet, test call, mode); owner alerts by text; usage and caps; evals for SMS replies | 1–1.5 weeks |
| **2. Voice test** | Two prototypes, the measurements in §6, decision | 3 days |
| **3. Voice v1** | `apps/voice`; `voice` channel, fast profile, reply shape; greeting and disclosure; `transfer_call`, `send_text`; voicemail fallback; transcript, summary, owner alert; call log; limits | 2–3 weeks |
| **4. Emergencies and hardening** | On-call list escalation; recordings with retention; drain on deploy; load test for seasonal peaks; voice eval set; status page for telephony | 1–2 weeks |
| Later | Reminders and confirmations (transactional); appointment booking by voice once calendar integrations exist; a second telephony provider | — |

### Phase 1 as built

Built (`packages/telephony`, `packages/core/src/sms`, `apps/api/src/routes/telephony.ts` and
`phone.ts`, the worker's `message.send` job, migration 0041):

- **Provider interface and Twilio adapter** without the SDK: signature check, inbound text, incoming
  call, delivery report, sending, TwiML answers. A fake provider for tests.
- **Tables** `phone_numbers`, `outbound_messages`, `sms_opt_outs`, all with RLS; a number is found
  without tenant context through `app_resolve_phone_number`, like page links.
- **Inbound text:** signature → number → STOP / START / HELP (English and French) → daily limit per
  customer number (40) → the assistant answers on channel `sms` in the customer's thread (a new
  thread after 24 hours) → the reply is queued. The webhook is acknowledged at once and the answer
  is written after it. A webhook delivered twice is answered once.
- **Reply shape:** an SMS section in the prompt (plain text, short, no button or photo markers, phone
  number and links written out), and `toSmsText` on the way out (Markdown removed, typographic
  punctuation made plain so an English text stays in the cheap 7-bit format, cut at a sentence above
  1,200 characters).
- **Requests by text** carry the number the customer writes from, without asking for it.
- **Missed-call text-back:** a call to a number in "text back" mode hears one sentence and gets one
  text a day, which opens the conversation; nothing is sent to a withheld or opted-out number.
- **Sending:** job `message.send` in the worker, retried when the provider is down, marked failed
  when the number can't receive texts; the carrier's own opt-out (Twilio 21610) is remembered;
  usage recorded per message part (`usage_events` kind `sms`); delivery reports update the message.
- **Phone settings API:** staff assign or remove an assistant's number (support mode, audited); the
  business turns texting on or off and chooses what a call does.
- **Phone & texts tab** in the admin portal (EN/FR): the number, texts sent and opt-outs in the last
  30 days, the two settings, how to forward missed calls, and for staff the webhook addresses and
  assigning the number. It passes the `pnpm a11y` checks on desktop and phone (owner view).
- **`TELEPHONY_PROVIDER=fake`** for local development without a provider account.

Checked with the real model (DeepSeek V4.1 Flash, voyage-4-lite): an English question, a French one,
a burst pipe and a callback request were answered correctly in 80–250 characters; simple answers
took 2.5–4 s, turns that save a request 15–23 s.

Not built yet, in this order:

1. **A test call the portal can see** ("we received your test call") and per-carrier forwarding
   sheets; the tab gives general instructions for now.
2. **A live test with Twilio.** Nothing has been sent through a real number: needs the account and
   the sender registration of phase 0.
3. **Owner alerts by text**, and the daily spend cap (usage is recorded; nothing stops at a cap).
4. **Photos in by MMS** (the text says only text can be read), and "reply QUOTE" for a service.
5. **Buying numbers through the provider** (staff enter a number bought in Twilio's console).
6. **SMS eval cases.**

Known limits: repeated webhooks are recognised in the memory of one API server (two servers could
both answer a retry); an answer being written when the API restarts is lost; French texts usually
contain a character outside the 7-bit alphabet (ê, ç, â), so they are billed in 70-character parts.
Seen once in the real-model check: the assistant passed the same request on twice when the customer
added a detail in a later text (the web chat can do the same).

## 10. Open decisions

1. **Default voice backend** — decided by §6. Recommended starting position: B, with A available.
2. **Number type for texting:** local number (feels local, registration unclear) or verified toll-free
   (clear rules, less local). Depends on phase 0.
3. **Answer every call or only the missed ones** by default. Recommended: only forwarded missed and
   after-hours calls; the owner can switch to all calls.
4. **Recording default.** Recommended: off until the business turns it on; transcripts always.
5. **Who pays for minutes:** an allowance per plan with overage, or pay-as-you-go. After §6.
6. **French on calls from day one,** or English first. Recommended: both, since the test covers it.
