/** Calls to the public chat API (same origin as this page). */

import type { PublicAppearance } from "@traiblazer/appearance";

export interface PublicLanguage {
  code: string;
  nativeName: string;
  dir: "ltr" | "rtl";
}

export interface PublicBotConfig {
  name: string;
  businessName: string;
  appearance: PublicAppearance;
  languages: PublicLanguage[];
  defaultLanguage: string;
  greeting: Record<string, string>;
  quickReplies: Record<string, string[]>;
  /** Buttons from the business's add-ons (e.g. its online shop). Missing on older API versions. */
  links?: ChatLink[];
  poweredBy: boolean;
  /** For an agency's client: the agency's credit instead of ours (missing on older API versions). */
  poweredByAgency?: { name: string; url: string | null } | null;
  contact: { phone: string | null; email: string | null };
}

/** A button from an add-on; `label` null = the translated default for `icon`. */
export interface ChatLink {
  id: string;
  url: string;
  label: string | null;
  icon: "shop" | "link";
}

export interface Citation {
  title: string | null;
  url: string | null;
}

/** An image the visitor sent; the transcript shows only its name. */
export interface AttachmentName {
  name: string;
}

/** A business photo shown with an assistant reply. */
export interface ReplyPhoto {
  url: string;
  alt: string;
}

/**
 * A button under an assistant reply. With `item` it is about one service or product: it opens `href`
 * when there is one (the booking link), otherwise it asks for that quote or booking in the chat.
 */
export interface ReplyAction {
  kind: "call" | "book" | "quote";
  href?: string;
  item?: { id: string; name: string };
}

/** A promotion the business is running, shown as a card under a reply in the owner's own words. */
export interface ReplyOffer {
  id: string;
  title: string;
  text: string;
  /** ISO time it ends, or null. */
  endsAt: string | null;
}

/** A service or product shown as a card under a reply, in the owner's own words. */
export interface ReplyItem {
  id: string;
  kind: "service" | "product";
  name: string;
  description: string | null;
  priceText: string | null;
  photoUrl: string | null;
  /** The button the owner chose for the item: "quote" and "book" are shown on the card. */
  action: "ask" | "quote" | "book";
  /** For a "book" item: the business's booking link, when it has one. */
  href?: string;
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  attachments?: AttachmentName[];
  images?: ReplyPhoto[];
  actions?: ReplyAction[];
  offers?: ReplyOffer[];
  items?: ReplyItem[];
}

export type StreamEvent =
  | { type: "start"; conversationId: string }
  | { type: "text"; text: string }
  /** The reply text so far is taken back; what follows replaces it. */
  | { type: "reset" }
  | { type: "image"; image: ReplyPhoto }
  /** The message sounds urgent or dangerous: show the phone number now. */
  | { type: "urgent"; level: "urgent" | "danger"; phone: string | null }
  | { type: "action"; action: ReplyAction }
  | { type: "offer"; offer: ReplyOffer }
  | { type: "item"; item: ReplyItem }
  | { type: "done"; messageId: string; citations: Citation[] }
  | { type: "error"; code: string; message: string };

export async function fetchConfig(publicKey: string): Promise<PublicBotConfig> {
  const res = await fetch(`/v1/public/bots/${encodeURIComponent(publicKey)}`);
  if (!res.ok) throw new Error(`config ${res.status}`);
  return (await res.json()).bot as PublicBotConfig;
}

export async function fetchHistory(
  publicKey: string,
  conversationId: string,
  visitorId: string,
): Promise<StoredMessage[]> {
  const params = new URLSearchParams({ key: publicKey, visitorId });
  const res = await fetch(`/v1/public/conversations/${encodeURIComponent(conversationId)}?${params}`);
  if (!res.ok) return [];
  return (await res.json()).messages as StoredMessage[];
}

/** POSTs a message and yields server-sent events as they arrive. */
export async function* streamChat(body: {
  publicKey: string;
  conversationId: string | null;
  visitorId: string;
  message: string;
  images: { name: string; data: string }[];
  channel: string;
  pageUrl: string | null;
}): AsyncGenerator<StreamEvent> {
  const res = await fetch("/v1/public/chat", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    const known = [
      "quota",
      "busy",
      "visitor",
      "conversation",
      "not_found",
      "images",
      "image_type",
      "image_size",
    ];
    // Any other 429 is the per-IP flood protection: the visitor is typing too fast.
    const code = known.includes(data.error) ? data.error : res.status === 429 ? "slowDown" : "failed";
    yield { type: "error", code, message: data.message ?? "Request failed" };
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let index = buffer.indexOf("\n\n");
    while (index !== -1) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) yield JSON.parse(data) as StreamEvent;
      index = buffer.indexOf("\n\n");
    }
  }
}

/**
 * Statistics: a service's button was tapped, on its card on the page or under an answer. Says which
 * service, never who; sent in the background and never waited for.
 */
export function countItemTap(publicKey: string, itemId: string, surface: "page" | "chat"): void {
  try {
    const body = new Blob([JSON.stringify({ publicKey, itemId, surface })], { type: "application/json" });
    navigator.sendBeacon?.("/v1/public/item-events", body);
  } catch {
    // Counting is never worth an error in the chat.
  }
}
