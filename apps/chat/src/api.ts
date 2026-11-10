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

/** A button under an assistant reply. */
export interface ReplyAction {
  kind: "call" | "book";
  href: string;
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  attachments?: AttachmentName[];
  images?: ReplyPhoto[];
  actions?: ReplyAction[];
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
