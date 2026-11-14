import type { EvalCase } from "../types.js";

/**
 * Promotions (docs/SELL_AND_PROMOTE.md §3.2). The tire shop runs one offer about its tire
 * changeover and has one that ended; the plumbing company has none.
 */
const OFFER = "Winter changeover special";
const INVENTED = [/\b\d{1,2} ?% (off|de rabais)\b/i, /\b(coupon|promo) code\b/i];

export const offerCases: EvalCase[] = [
  {
    id: "auto.en.offer-changeover",
    business: "auto",
    language: "en",
    category: "offer",
    turns: ["How much is a tire changeover?"],
    expect: { mentions: [["80"]], offer: OFFER, itemButton: { kind: "book", item: "Tire changeover" } },
    note: "A question about the offer's service shows the offer, with that service's button.",
  },
  {
    id: "auto.fr.offer-changeover",
    business: "auto",
    language: "fr",
    category: "offer",
    turns: ["Combien coûte un changement de pneus ?"],
    expect: { mentions: [["80"]], offer: OFFER },
  },
  {
    id: "auto.en.offer-deals",
    business: "auto",
    language: "en",
    category: "offer",
    turns: ["Do you have any specials on right now?"],
    expect: { offer: OFFER, avoids: [/summer ac/i, ...INVENTED], unanswered: false },
    note: "The running offer is shown; the one that ended is not mentioned.",
  },
  {
    id: "auto.en.offer-unrelated",
    business: "auto",
    language: "en",
    category: "offer",
    turns: ["What time do you close on Saturday?"],
    expect: { offer: "none" },
  },
  {
    id: "auto.en.offer-ended",
    business: "auto",
    language: "en",
    category: "offer",
    turns: ["Is the free AC check with an oil change still on?"],
    expect: {
      avoids: [/\byes\b[^.]*\b(still|free)\b/i, /\b(is|it's|it is) still (on|running|available)\b/i],
    },
    note: "An offer that ended isn't confirmed. Pointing to the one that is running is fine.",
  },
  {
    id: "trades.en.offer-none",
    business: "trades",
    language: "en",
    category: "prices",
    turns: ["Do you have any promotions or discounts going on right now?"],
    // The seniors' 10% off labour is in the business's text: a fact, not an invented promotion.
    expect: {
      offer: "none",
      avoids: [/\b(?!10 ?%)\d{1,2} ?% (off|de rabais)\b/i, /\b(coupon|promo) code\b/i],
    },
    note: "No promotion is running: none is made up.",
  },
  {
    id: "auto.en.offer-not-when-urgent",
    business: "auto",
    language: "en",
    category: "restraint",
    turns: ["I have a flat tire and I'm stuck on the side of the highway. Can you help?"],
    expect: { offer: "none", itemButton: "none", urgency: "urgent" },
  },
  {
    id: "auto.en.sms-offer",
    business: "auto",
    language: "en",
    category: "offer",
    channel: "sms",
    turns: ["How much is a tire changeover?"],
    expect: {
      mentions: [["80"], ["Winter changeover special: A free wheel alignment check"]],
      offer: OFFER,
    },
    note: "By text the offer is a line in the owner's own words.",
  },
];
