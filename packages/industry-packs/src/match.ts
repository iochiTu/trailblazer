/**
 * Recognizes an industry from how an owner describes their business ("we're a small bakery in
 * Guelph", "garage et pneus"), in English or French, without a model call. The onboarding chat asks
 * the model only when this finds nothing or can't decide.
 */
import type { IndustryPack } from "./index.js";

/** Word starts that point to a pack or one of its variants (lowercase, accents removed). */
const CUES: Record<string, Record<string, string[]>> = {
  trades: {
    plumbing: ["plumb", "plomb", "drain"],
    hvac: [
      "hvac",
      "furnace",
      "heating",
      "air condition",
      "chauffage",
      "climatisation",
      "fournaise",
      "thermopompe",
      "heat pump",
    ],
    electrical: ["electric", "electri"],
    roofing: ["roof", "toiture", "couvreur"],
    "landscaping-snow": ["landscap", "lawn", "snow", "paysag", "deneige", "pelouse"],
    cleaning: ["cleaning", "cleaner", "janitor", "menage", "nettoyage", "entretien menager"],
    "": ["contractor", "renovat", "handyman", "entrepreneur", "renovation", "home service"],
  },
  "auto-repair": {
    tires: ["tire", "tyre", "pneu"],
    "body-collision": ["body shop", "collision", "carross"],
    glass: ["windshield", "pare-brise", "auto glass"],
    "oil-change": ["oil change", "lube", "vidange"],
    detailing: ["detailing", "esthetique auto"],
    "general-repair": ["mechanic", "mecani", "auto repair", "car repair", "garage"],
  },
  restaurant: {
    pub: ["pub ", "bar ", "bars ", "tavern", "brasserie", "taverne"],
    "fine-dining": ["fine dining", "gastronom"],
    buffet: ["buffet"],
    takeout: ["takeout", "take-out", "pizzeria", "a emporter", "food truck", "casse-croute"],
    casual: ["restaurant", "diner", "bistro", "grill", "eatery", "resto"],
  },
  "cafe-bakery": {
    bakery: ["baker", "boulanger", "patiss", "cake", "gateau", "pastry", "viennoiser"],
    "coffee-roaster": ["roaster", "torrefact"],
    cafe: ["cafe", "coffee", "espresso", "tea room", "salon de the"],
  },
  retail: {
    florist: ["florist", "fleuris", "flower"],
    jewellery: ["jewel", "bijout", "bijoux"],
    hardware: ["hardware", "quincaill"],
    "books-hobby": ["book", "librair", "hobby", "collectib", "comic", "game store"],
    "clothing-outdoor": ["clothing", "apparel", "vetement", "outdoor gear", "boutique de mode"],
    "gift-artisan": ["gift", "cadeau", "artisan ", "artisans ", "souvenir"],
    "international-food-goods": ["grocery", "epicerie", "specialty food"],
    "": ["store", "shop", "magasin", "retail", "detaillant"],
  },
  "personal-care": {
    barber: ["barber", "barbier"],
    spa: ["spa ", "spas ", "massage", "esthetic", "esthetique", "nail", "ongle", "facial"],
    "tattoo-piercing": ["tattoo", "tatou", "piercing"],
    salon: ["salon", "hair", "coiff"],
  },
  lodging: {
    "": [
      "hotel",
      "motel",
      "inn ",
      "inns ",
      "b&b",
      "bed and breakfast",
      "gite",
      "auberge",
      "lodge",
      "cottage",
      "chalet",
      "camping",
      "campground",
      "resort",
      "hostel",
    ],
  },
  attractions: {
    "": [
      "museum",
      "musee",
      "tour ",
      "tours ",
      "attraction",
      "zoo ",
      "aquarium",
      "escape room",
      "golf",
      "theme park",
      "gallery",
      "galerie",
      "farm",
      "winery",
      "vignoble",
    ],
  },
};

const fold = (text: string) =>
  ` ${text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}&+-]+/gu, " ")} `;

export interface IndustryMatch {
  pack: string;
  variant: string | null;
}

/**
 * The one industry the description points to, among `available`; null when it names none or
 * several equally (a "café and bakery" is fine: both cues are the same pack).
 */
export function matchIndustry(description: string, available: IndustryPack[]): IndustryMatch | null {
  const text = fold(description);
  const scores: { pack: string; score: number; variant: string | null; variantScore: number }[] = [];
  for (const pack of available) {
    const cues = CUES[pack.slug];
    if (!cues) continue;
    let score = 0;
    let best: { variant: string | null; score: number } = { variant: null, score: 0 };
    for (const [variant, words] of Object.entries(cues)) {
      // A cue matches at the start of a word ("plumb" in "plumbers"), never inside one; a cue
      // ending with a space is a whole word ("spa", not "spaghetti").
      const hits = words.filter((word) =>
        text.includes(` ${fold(word).trim()}${word.endsWith(" ") ? " " : ""}`),
      ).length;
      // A broad word ("shop", "store") counts less than a specific one ("barber", "coffee").
      score += variant ? hits : hits / 2;
      if (variant && hits > best.score && pack.variants.some((v) => v.slug === variant)) {
        best = { variant, score: hits };
      }
    }
    if (score > 0) scores.push({ pack: pack.slug, score, variant: best.variant, variantScore: best.score });
  }
  if (!scores.length) return null;
  scores.sort((a, b) => b.score - a.score);
  if (scores[1] && scores[1].score === scores[0]!.score) return null;
  return { pack: scores[0]!.pack, variant: scores[0]!.variant };
}
