import { z } from "zod";
import { defineAddon } from "../types.js";

const PLATFORMS = {
  shopify: "Shopify",
  square: "Square Online",
  woocommerce: "WooCommerce",
  etsy: "Etsy",
  other: null,
} as const;
type Platform = keyof typeof PLATFORMS;

const schema = z.object({
  url: z.url({ protocol: /^https?$/ }).max(2048),
  platform: z.enum(Object.keys(PLATFORMS) as [Platform, ...Platform[]]).default("other"),
  /** What the shop sells, shipping/pickup, etc. Read by the assistant like the business profile. */
  note: z.string().trim().max(500).default(""),
  showButton: z.boolean().default(true),
  /** Empty = the chat page's translated "Shop online". */
  buttonLabel: z.string().trim().max(30).default(""),
});
export type OnlineShopConfig = z.infer<typeof schema>;

export const onlineShop = defineAddon<OnlineShopConfig>({
  id: "online-shop",
  version: 1,
  category: "commerce",
  status: "available",
  icon: "🛍️",
  name: { en: "Online shop", fr: "Boutique en ligne" },
  summary: {
    en: "Send visitors who want to buy to your online store, with a Shop button in the chat.",
    fr: "Dirigez les visiteurs qui veulent acheter vers votre boutique, avec un bouton Boutique dans la conversation.",
  },
  description: {
    en: "Works with any online store (Shopify, Square, WooCommerce, Etsy…). When visitors ask how to buy or order, your assistant shares your shop link. Product-by-product answers from your catalog are coming in a later add-on.",
    fr: "Fonctionne avec toute boutique en ligne (Shopify, Square, WooCommerce, Etsy…). Quand un visiteur demande comment acheter ou commander, l'assistant partage le lien de votre boutique. Les réponses produit par produit viendront avec un prochain module.",
  },
  capabilities: ["prompt", "chat_links"],
  fields: [
    {
      key: "url",
      type: "url",
      label: { en: "Shop address", fr: "Adresse de la boutique" },
      placeholder: "https://shop.example.com",
      required: true,
      maxLength: 2048,
    },
    {
      key: "platform",
      type: "select",
      label: { en: "Platform", fr: "Plateforme" },
      options: [
        ...(["shopify", "square", "woocommerce", "etsy"] as const).map((value) => ({
          value,
          label: { en: PLATFORMS[value], fr: PLATFORMS[value] },
        })),
        { value: "other", label: { en: "Other", fr: "Autre" } },
      ],
    },
    {
      key: "note",
      type: "textarea",
      label: { en: "About your shop (optional)", fr: "À propos de votre boutique (facultatif)" },
      hint: {
        en: "What you sell online, shipping or pickup, delivery areas. Your assistant uses this in its answers.",
        fr: "Ce que vous vendez en ligne, livraison ou cueillette, zones desservies. L'assistant s'en sert pour répondre.",
      },
      maxLength: 500,
    },
    {
      key: "showButton",
      type: "toggle",
      label: { en: "Show a Shop button in the chat", fr: "Afficher un bouton Boutique dans la conversation" },
    },
    {
      key: "buttonLabel",
      type: "text",
      label: { en: "Button text (optional)", fr: "Texte du bouton (facultatif)" },
      placeholder: "Shop online",
      maxLength: 30,
    },
  ],
  schema,
  defaults: { url: "", platform: "other", note: "", showButton: true, buttonLabel: "" },

  prompt(config) {
    const platform = PLATFORMS[config.platform];
    return [
      `## Online shop`,
      `Online shop${platform ? ` (${platform})` : ""}: ${config.url}`,
      config.note ? `About the shop: ${config.note.replace(/[<>]/g, "")}` : null,
      "When a visitor wants to buy, order or browse products online, share this link.",
    ]
      .filter(Boolean)
      .join("\n");
  },

  chatLinks(config) {
    if (!config.showButton) return [];
    return [{ id: "online-shop", url: config.url, label: config.buttonLabel || null, icon: "shop" }];
  },
});
