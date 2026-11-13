import { FakeTelephony } from "./fake.js";
import { TwilioProvider } from "./twilio.js";
import type { TelephonyProvider } from "./types.js";

/** The telephony provider from the environment, or null when phone and SMS aren't set up. */
export function createTelephonyFromEnv(env: NodeJS.ProcessEnv = process.env): TelephonyProvider | null {
  // Local development without a provider account: nothing is sent, texts are kept in memory.
  if (env.TELEPHONY_PROVIDER === "fake" && env.NODE_ENV !== "production") return new FakeTelephony();
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) return null;
  return new TwilioProvider({ accountSid, authToken });
}
