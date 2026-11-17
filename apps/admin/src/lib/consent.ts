/**
 * The visitor's cookie choice. Today the site only uses strictly necessary storage, so "rejected"
 * changes nothing yet; anything optional added later (analytics, chat history beyond the visit,
 * marketing pixels) must check `hasConsent()` first and listen for CONSENT_EVENT.
 */

export const CONSENT_COOKIE = "tb_consent";
export type Consent = "accepted" | "rejected";

/** Fired on window with the new choice as `detail` whenever the visitor decides. */
export const CONSENT_EVENT = "tb:consent";
/** Fire on window to show the banner again (the footer's "Cookie settings" link). */
export const CONSENT_OPEN_EVENT = "tb:consent:open";

/** Ask again after about six months, as Quebec's Law 25 and the GDPR guidance expect. */
const MAX_AGE = 60 * 60 * 24 * 182;

export const parseConsent = (value: string | undefined): Consent | null =>
  value === "accepted" || value === "rejected" ? value : null;

export function readConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)tb_consent=([^;]*)/);
  return parseConsent(match?.[1]);
}

export const hasConsent = () => readConsent() === "accepted";

export function saveConsent(choice: Consent) {
  // biome-ignore lint/suspicious/noDocumentCookie: preference cookie, also read on the server
  document.cookie = `${CONSENT_COOKIE}=${choice}; path=/; max-age=${MAX_AGE}; samesite=lax`;
  window.dispatchEvent(new CustomEvent<Consent>(CONSENT_EVENT, { detail: choice }));
}
