import { describe, expect, it } from "vitest";
import { createTelephonyFromEnv } from "./config.js";
import { formatPhone, toE164 } from "./numbers.js";
import { smsKeyword, smsSegments, toSmsText } from "./sms.js";
import { TwilioProvider, twilioSignature } from "./twilio.js";
import { PermanentSendError } from "./types.js";

describe("phone numbers", () => {
  it("reads Canadian numbers however they are written", () => {
    expect(toE164("(807) 555-0142")).toBe("+18075550142");
    expect(toE164("1-807-555-0142")).toBe("+18075550142");
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
    expect(toE164("555-0142")).toBeNull();
    expect(toE164("")).toBeNull();
    expect(formatPhone("+18075550142")).toBe("+1 807 555 0142");
  });
});

describe("text messages", () => {
  it("recognises STOP, START and HELP in English and French, alone in the message", () => {
    expect(smsKeyword(" Stop. ")).toBe("stop");
    expect(smsKeyword("ARRÊT")).toBe("stop");
    expect(smsKeyword("aide")).toBe("help");
    expect(smsKeyword("START")).toBe("start");
    expect(smsKeyword("please stop by tomorrow")).toBeNull();
  });

  it("counts the parts a text is billed as", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("Très bien, à bientôt")).toBe(1);
    // "ê" isn't in the 7-bit alphabet: the whole text counts in 70s.
    expect(smsSegments(`Êtes-vous là ? ${"a".repeat(60)}`)).toBe(2);
    expect(smsSegments("👍")).toBe(1);
  });

  it("turns a chat reply into plain text and cuts a long one at a sentence", () => {
    expect(toSmsText("**Yes**, we do.\n\n\n- [Book online](https://b.example/x)\n* Call `us`")).toBe(
      "Yes, we do.\n\n- Book online: https://b.example/x\n- Call us",
    );
    // Typographic punctuation would make an English text cost Unicode parts.
    const plain = toSmsText("Yes \u2014 we\u2019re open 9\u201317\u2026 \u201Ccall us\u201D");
    expect(plain).toBe('Yes - we\'re open 9-17... "call us"');
    expect(smsSegments(plain)).toBe(1);
    const long = `${"We are open every day. ".repeat(80)}`;
    const cut = toSmsText(long, 200);
    expect(cut.length).toBeLessThanOrEqual(200);
    expect(cut.endsWith("day.")).toBe(true);
  });
});

describe("Twilio", () => {
  const token = "secret-token";
  const url = "https://api.example.com/v1/telephony/twilio/sms";
  const params = { From: "+18075550199", To: "+18075550142", Body: " Do you fix leaks? ", MessageSid: "SM1" };

  it("accepts only requests signed with the account's token", () => {
    const twilio = new TwilioProvider({ accountSid: "AC1", authToken: token });
    const signature = twilioSignature(token, url, params);
    expect(twilio.verifyWebhook({ url, params, signature })).toBe(true);
    expect(twilio.verifyWebhook({ url, params: { ...params, Body: "other" }, signature })).toBe(false);
    expect(twilio.verifyWebhook({ url: `${url}?x=1`, params, signature })).toBe(false);
    expect(twilio.verifyWebhook({ url, params, signature: undefined })).toBe(false);
    expect(twilio.verifyWebhook({ url, params, signature: "not-base64!" })).toBe(false);
  });

  it("reads inbound texts, calls and delivery reports", () => {
    const twilio = new TwilioProvider({ accountSid: "AC1", authToken: token });
    expect(
      twilio.parseInboundMessage({
        ...params,
        NumMedia: "1",
        MediaUrl0: "https://m.example/1",
        MediaContentType0: "image/jpeg",
      }),
    ).toEqual({
      id: "SM1",
      from: "+18075550199",
      to: "+18075550142",
      text: "Do you fix leaks?",
      media: [{ url: "https://m.example/1", contentType: "image/jpeg" }],
    });
    expect(twilio.parseInboundMessage({ Body: "x" })).toBeNull();
    expect(twilio.parseIncomingCall({ CallSid: "CA1", From: "anonymous", To: "+18075550142" })).toEqual({
      id: "CA1",
      from: null,
      to: "+18075550142",
    });
    expect(
      twilio.parseMessageStatus({ MessageSid: "SM2", MessageStatus: "undelivered", ErrorCode: "30006" }),
    ).toEqual({
      id: "SM2",
      status: "failed",
      errorCode: "30006",
    });
  });

  it("sends a text, and tells a refusal that won't change from one worth retrying", async () => {
    const calls: { url: string; body: string; auth: string }[] = [];
    let next: { status: number; body: object } = { status: 201, body: { sid: "SM9", status: "queued" } };
    const fetch = (async (input: string, init: RequestInit) => {
      calls.push({
        url: input,
        body: String(init.body),
        auth: (init.headers as Record<string, string>).authorization!,
      });
      return Response.json(next.body, { status: next.status });
    }) as unknown as typeof globalThis.fetch;
    const twilio = new TwilioProvider({ accountSid: "AC1", authToken: token, fetch });
    const message = { from: "+18075550142", to: "+18075550199", text: "Yes, we do." };

    expect(
      await twilio.sendMessage({ ...message, statusCallbackUrl: "https://api.example.com/s?m=1" }),
    ).toEqual({
      id: "SM9",
      status: "queued",
    });
    expect(calls[0]!.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    expect(new URLSearchParams(calls[0]!.body).get("StatusCallback")).toBe("https://api.example.com/s?m=1");
    expect(calls[0]!.auth).toBe(`Basic ${Buffer.from(`AC1:${token}`).toString("base64")}`);

    next = { status: 400, body: { code: 21610, message: "Attempt to send to unsubscribed recipient" } };
    await expect(twilio.sendMessage(message)).rejects.toBeInstanceOf(PermanentSendError);
    next = { status: 503, body: {} };
    await expect(twilio.sendMessage(message)).rejects.not.toBeInstanceOf(PermanentSendError);
  });

  it("answers webhooks in TwiML", () => {
    const twilio = new TwilioProvider({ accountSid: "AC1", authToken: token });
    expect(twilio.replySayAndHangUp("Thanks for calling Smith & Sons.", "fr").body).toContain(
      '<Say language="fr-CA">Thanks for calling Smith &amp; Sons.</Say><Hangup/>',
    );
    expect(twilio.replyNothing().body).toContain("<Response></Response>");
  });

  it("is set up from the environment only when both values are there", () => {
    expect(createTelephonyFromEnv({})).toBeNull();
    expect(createTelephonyFromEnv({ TELEPHONY_PROVIDER: "fake" })?.id).toBe("fake");
    expect(createTelephonyFromEnv({ TELEPHONY_PROVIDER: "fake", NODE_ENV: "production" })).toBeNull();
    expect(createTelephonyFromEnv({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: " t " })?.id).toBe(
      "twilio",
    );
  });
});
