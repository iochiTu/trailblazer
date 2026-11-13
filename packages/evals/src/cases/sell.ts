import type { EvalCase } from "../types.js";

/**
 * Selling in the chat (docs/SELL_AND_PROMOTE.md): the button for the service the visitor asked
 * about, the request that names it, and no selling when the visitor needs help instead.
 */
export const sellCases: EvalCase[] = [
  {
    id: "trades.en.sell-water-heater",
    business: "trades",
    language: "en",
    category: "sell",
    turns: ["Do you install tankless water heaters?"],
    expect: { itemButton: { kind: "quote", item: "Water heater installation" }, urgency: "none" },
  },
  {
    id: "trades.fr.sell-sump-pump",
    business: "trades",
    language: "fr",
    category: "sell",
    turns: ["Est-ce que vous installez des pompes de puisard ?"],
    expect: { itemButton: { kind: "quote", item: "Sump pump installation" }, urgency: "none" },
  },
  {
    id: "trades.en.sell-quote-names-service",
    business: "trades",
    language: "en",
    category: "sell",
    turns: [
      "Do you install sump pumps?",
      // What a tap on the button sends.
      "I'd like a quote for Sump pump installation.",
      "Sam Patel, 807-555-0199. I'm at 22 Red River Rd, Thunder Bay. Afternoons are best.",
    ],
    moreDetails: "It's a house. That's everything, please pass it on.",
    expect: { request: { kind: ["quote", "callback"], item: "Sump pump installation" } },
  },
  {
    id: "trades.en.sell-no-button-to-ask",
    business: "trades",
    language: "en",
    category: "sell",
    turns: ["Do you fix leaking faucets?"],
    expect: { itemButton: "none" },
    note: 'Leak repair is an "ask about this" service: no quote or booking button was set for it.',
  },
  {
    id: "auto.en.sell-alignment",
    business: "auto",
    language: "en",
    category: "sell",
    turns: ["How much is a wheel alignment?"],
    expect: { mentions: [["119.95"]], itemButton: { kind: "book", item: "Wheel alignment" } },
  },
  {
    id: "auto.fr.sell-oil-change",
    business: "auto",
    language: "fr",
    category: "sell",
    turns: ["Combien coûte un changement d'huile ?"],
    expect: { mentions: [["69.95", "69,95"]], itemButton: { kind: "book", item: "Oil change" } },
  },
  {
    id: "auto.fr.sell-hours-no-button",
    business: "auto",
    language: "fr",
    category: "sell",
    turns: ["Êtes-vous ouverts le samedi ?"],
    expect: { itemButton: "none" },
    note: "A question that isn't about a service gets no service button.",
  },
  {
    id: "trades.en.restraint-urgent",
    business: "trades",
    language: "en",
    category: "restraint",
    turns: ["My water heater is leaking all over the basement floor right now!"],
    expect: { itemButton: "none", urgency: "urgent", actions: ["call"] },
  },
  {
    id: "trades.fr.restraint-urgent",
    business: "trades",
    language: "fr",
    category: "restraint",
    turns: ["Mon chauffe-eau coule partout sur le plancher du sous-sol en ce moment !"],
    expect: { itemButton: "none", urgency: "urgent", actions: ["call"] },
  },
  {
    id: "auto.en.restraint-advice",
    business: "auto",
    language: "en",
    category: "restraint",
    turns: ["My brakes are making a grinding noise. Is it safe to keep driving to work this week?"],
    expect: { itemButton: "none" },
  },
  {
    id: "auto.en.restraint-complaint",
    business: "auto",
    language: "en",
    category: "restraint",
    turns: ["You mounted my tires last week and one is already flat. I'm really not happy about this."],
    expect: { itemButton: "none" },
  },
  {
    id: "auto.fr.restraint-complaint",
    business: "auto",
    language: "fr",
    category: "restraint",
    turns: [
      "Vous avez fait mon changement d'huile hier et ma voiture perd de l'huile. Je suis très mécontent.",
    ],
    expect: { itemButton: "none" },
  },
];
