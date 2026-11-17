import { useEffect, useRef, useState } from "preact/hooks";
import type { ReplyItem } from "./api";
import { Icon } from "./Icon";
import { ui } from "./strings";

interface CardsProps {
  items: ReplyItem[];
  lang: string;
  /** The business's online shop (from its Online shop add-on), or null. */
  shopUrl: string | null;
  /** True while an answer is being written: buttons that send a message wait. */
  busy: boolean;
  /** Sends a message in the chat, as if the visitor typed it. */
  send: (text: string) => void;
  /** Statistics: one of the item's buttons was tapped. */
  tapped: (itemId: string) => void;
}

type CardButton =
  | { kind: "link"; label: string; icon: "shop" | "book"; href: string }
  | { kind: "send"; label: string; icon: "book" | "ask"; message: string };

/** The buttons on one card: the main one first, then at most one quieter one. */
function buttonsFor(item: ReplyItem, lang: string, shopUrl: string | null): CardButton[] {
  const shop: CardButton | null =
    shopUrl && item.kind === "product"
      ? { kind: "link", label: ui(lang, "cardShop"), icon: "shop", href: shopUrl }
      : null;
  const own: CardButton | null =
    item.action === "book" && item.href && /^https?:\/\//i.test(item.href)
      ? { kind: "link", label: ui(lang, "cardBook"), icon: "book", href: item.href }
      : item.action === "book" || item.action === "quote"
        ? {
            kind: "send",
            label: ui(lang, item.action === "book" ? "cardBook" : "cardQuote"),
            icon: "book",
            message: ui(lang, item.action === "book" ? "bookMessage" : "quoteMessage", { item: item.name }),
          }
        : null;
  const ask: CardButton = {
    kind: "send",
    label: ui(lang, "cardAsk"),
    icon: "ask",
    message: ui(lang, "askMessage", { item: item.name }),
  };
  const main = shop ?? own ?? ask;
  const second = shop && own ? own : main === ask ? null : ask;
  return second ? [main, second] : [main];
}

/**
 * Services and products under a reply, as a row of cards the visitor can scroll through (photo,
 * name, price, a short description and the item's buttons). Arrows appear on wide screens when
 * there are more cards than fit.
 */
export function Cards({ items, lang, shopUrl, busy, send, tapped }: CardsProps) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      // In right-to-left text scrollLeft runs from 0 down to negative values.
      const offset = Math.abs(track.scrollLeft);
      const room = track.scrollWidth - track.clientWidth;
      setEdges({ start: offset < 4, end: offset > room - 4 });
    };
    measure();
    track.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(track);
    return () => {
      track.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [items.length]);

  const scroll = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const rtl = getComputedStyle(track).direction === "rtl";
    const step = Math.max(track.clientWidth * 0.8, 200);
    track.scrollBy({ left: direction * step * (rtl ? -1 : 1), behavior: "smooth" });
  };

  return (
    <div class="tb-cards" data-single={items.length === 1 ? "" : undefined}>
      <ul class="tb-cards-track" ref={trackRef} aria-label={ui(lang, "cardsLabel")}>
        {items.map((item) => (
          <li key={item.id} class="tb-card">
            <div class="tb-card-photo">
              {item.photoUrl ? (
                <img src={item.photoUrl} alt="" loading="lazy" />
              ) : (
                <Icon name={item.kind === "product" ? "shop" : "book"} size={28} />
              )}
            </div>
            <div class="tb-card-body">
              <strong class="tb-card-name" dir="auto">
                {item.name}
              </strong>
              {item.priceText && (
                <span class="tb-card-price" dir="auto">
                  {item.priceText}
                </span>
              )}
              {item.description && (
                <span class="tb-card-text" dir="auto">
                  {item.description}
                </span>
              )}
            </div>
            <div class="tb-card-buttons">
              {buttonsFor(item, lang, shopUrl).map((button, index) =>
                button.kind === "link" ? (
                  <a
                    key={button.label}
                    class="tb-card-button"
                    data-main={index === 0 ? "" : undefined}
                    href={button.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => tapped(item.id)}
                  >
                    <Icon name={button.icon} size={15} />
                    {button.label}
                  </a>
                ) : (
                  <button
                    key={button.label}
                    type="button"
                    class="tb-card-button"
                    data-main={index === 0 ? "" : undefined}
                    disabled={busy}
                    onClick={() => {
                      tapped(item.id);
                      send(button.message);
                    }}
                  >
                    <Icon name={button.icon} size={15} />
                    {button.label}
                  </button>
                ),
              )}
            </div>
          </li>
        ))}
      </ul>
      {!edges.start && (
        <button
          type="button"
          class="tb-cards-arrow"
          data-side="start"
          aria-label={ui(lang, "cardsPrev")}
          onClick={() => scroll(-1)}
        >
          <Icon name="chevron" size={18} />
        </button>
      )}
      {!edges.end && (
        <button
          type="button"
          class="tb-cards-arrow"
          data-side="end"
          aria-label={ui(lang, "cardsNext")}
          onClick={() => scroll(1)}
        >
          <Icon name="chevron" size={18} />
        </button>
      )}
    </div>
  );
}
