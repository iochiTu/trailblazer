/**
 * Industry catalog: sector → pack → variant and rollout phases (docs/PLAN.md §4.3). Each industry
 * comes with a template (response guidelines, suggested questions, workflows; see templates.ts)
 * that is copied into a new assistant and then belongs to the business.
 */

export type ScopeLevel = "standard" | "professional";

export interface PackVariant {
  slug: string;
  name: string;
}

export interface IndustryPack {
  slug: string;
  sector: string;
  name: string;
  /** Rollout phase from the plan. Only packs with phase <= AVAILABLE_PHASE can be selected. */
  phase: 1 | 2 | 3 | 4;
  /** "professional" packs run the strict customer-service-only scope rules (PLAN §5). */
  scope: ScopeLevel;
  variants: PackVariant[];
}

/** Packs from this phase or earlier can be chosen when creating a bot. */
export const AVAILABLE_PHASE = 1;

const v = (slug: string, name: string): PackVariant => ({ slug, name });

export const packs: IndustryPack[] = [
  // Phase 1 — launch
  {
    slug: "restaurant",
    sector: "food-drink",
    name: "Restaurant & bar",
    phase: 1,
    scope: "standard",
    variants: [
      v("casual", "Casual dining"),
      v("fine-dining", "Fine dining"),
      v("pub", "Pub / bar"),
      v("buffet", "Buffet"),
      v("takeout", "Takeout"),
    ],
  },
  {
    slug: "cafe-bakery",
    sector: "food-drink",
    name: "Café & bakery",
    phase: 1,
    scope: "standard",
    variants: [
      v("cafe", "Café"),
      v("bakery", "Bakery / custom cakes"),
      v("coffee-roaster", "Coffee roaster"),
    ],
  },
  {
    slug: "retail",
    sector: "retail",
    name: "Retail store",
    phase: 1,
    scope: "standard",
    variants: [
      v("clothing-outdoor", "Clothing & outdoor"),
      v("florist", "Florist"),
      v("gift-artisan", "Gift & artisan"),
      v("hardware", "Hardware"),
      v("jewellery", "Jewellery"),
      v("books-hobby", "Books, hobby & collectibles"),
      v("international-food-goods", "International / specialty food & goods"),
    ],
  },
  {
    slug: "personal-care",
    sector: "personal-care",
    name: "Salon, spa & barber",
    phase: 1,
    scope: "standard",
    variants: [
      v("salon", "Hair salon"),
      v("spa", "Spa"),
      v("barber", "Barber"),
      v("tattoo-piercing", "Tattoo & piercing"),
    ],
  },
  {
    slug: "lodging",
    sector: "hospitality-tourism",
    name: "Lodging",
    phase: 1,
    scope: "standard",
    variants: [
      v("motel", "Motel"),
      v("bnb", "B&B"),
      v("lodge-outfitter", "Lodge / outfitter"),
      v("small-hotel", "Small hotel"),
    ],
  },
  {
    slug: "attractions",
    sector: "hospitality-tourism",
    name: "Attractions, tours & recreation",
    phase: 1,
    scope: "standard",
    variants: [
      v("tours", "Tours"),
      v("ski-trails", "Ski & trails"),
      v("golf", "Golf"),
      v("activity-venue", "Activity venue"),
    ],
  },
  { slug: "generic", sector: "generic", name: "Other business", phase: 1, scope: "standard", variants: [] },

  // Phase 2
  {
    slug: "grocery-market",
    sector: "food-drink",
    name: "Grocery & market",
    phase: 2,
    scope: "standard",
    variants: [
      v("farmers-market", "Farmers market"),
      v("specialty-grocery", "Specialty / international grocery"),
      v("butcher", "Butcher"),
    ],
  },
  {
    slug: "brewery-producer",
    sector: "food-drink",
    name: "Brewery & producer",
    phase: 2,
    scope: "standard",
    variants: [
      v("brewery", "Brewery / taproom"),
      v("farm", "Farm / market"),
      v("cidery-winery", "Cidery / winery"),
    ],
  },
  {
    slug: "arts-events",
    sector: "arts-events",
    name: "Arts, culture & events",
    phase: 2,
    scope: "standard",
    variants: [
      v("gallery", "Gallery"),
      v("museum", "Museum"),
      v("theatre", "Theatre"),
      v("festival", "Festival"),
      v("music-venue", "Music venue"),
    ],
  },
  {
    slug: "fitness",
    sector: "fitness",
    name: "Gym & studio",
    phase: 2,
    scope: "standard",
    variants: [v("gym", "Gym"), v("yoga", "Yoga studio"), v("martial-arts", "Martial arts")],
  },
  {
    slug: "business-services",
    sector: "business-services",
    name: "Business services",
    phase: 2,
    scope: "standard",
    variants: [
      v("agency", "Marketing agency"),
      v("it-web", "IT / web"),
      v("photography", "Photography"),
      v("printing", "Printing"),
      v("event-planning", "Event planning"),
      v("cleaning", "Cleaning"),
    ],
  },
  {
    slug: "trades",
    sector: "home-construction",
    name: "Trades & home services",
    phase: 2,
    scope: "standard",
    variants: [
      v("plumbing", "Plumbing"),
      v("hvac", "HVAC"),
      v("electrical", "Electrical"),
      v("landscaping-snow", "Landscaping & snow removal"),
    ],
  },
  {
    slug: "auto-repair",
    sector: "automotive",
    name: "Auto repair & service shop",
    phase: 2,
    scope: "standard",
    variants: [
      v("general-repair", "General repair"),
      v("tires", "Tires"),
      v("body-collision", "Body & collision"),
      v("glass", "Glass"),
      v("detailing", "Detailing"),
    ],
  },
  {
    slug: "small-education",
    sector: "education",
    name: "Tutoring & schools",
    phase: 2,
    scope: "standard",
    variants: [
      v("tutoring", "Tutoring"),
      v("language-school", "Language school"),
      v("driving-school", "Driving school"),
      v("music-school", "Music school"),
    ],
  },
  {
    slug: "nonprofit-settlement",
    sector: "community",
    name: "Non-profit & settlement services",
    phase: 2,
    scope: "standard",
    variants: [
      v("settlement", "Newcomer / settlement"),
      v("social-services", "Social services"),
      v("youth", "Youth"),
      v("community", "Community"),
    ],
  },

  // Phase 3 — professional (customer service only)
  {
    slug: "clinic",
    sector: "health-wellness",
    name: "Clinic",
    phase: 3,
    scope: "professional",
    variants: [
      v("dental", "Dental"),
      v("physio-chiro", "Physio / chiro"),
      v("vision-hearing", "Vision & hearing"),
      v("counselling", "Counselling"),
      v("aesthetics", "Medical aesthetics"),
    ],
  },
  {
    slug: "pharmacy",
    sector: "health-wellness",
    name: "Pharmacy",
    phase: 3,
    scope: "professional",
    variants: [],
  },
  {
    slug: "law-firm",
    sector: "legal-financial",
    name: "Law firm",
    phase: 3,
    scope: "professional",
    variants: [],
  },
  {
    slug: "accounting-tax",
    sector: "legal-financial",
    name: "Accounting & tax",
    phase: 3,
    scope: "professional",
    variants: [],
  },
  {
    slug: "insurance-financial",
    sector: "legal-financial",
    name: "Insurance & financial",
    phase: 3,
    scope: "professional",
    variants: [
      v("insurance-broker", "Insurance broker"),
      v("credit-union", "Credit union"),
      v("advisory", "Financial advisory"),
    ],
  },
  {
    slug: "immigration-consultant",
    sector: "legal-financial",
    name: "Immigration consultant",
    phase: 3,
    scope: "professional",
    variants: [],
  },
  {
    slug: "real-estate",
    sector: "real-estate",
    name: "Real estate",
    phase: 3,
    scope: "professional",
    variants: [],
  },
  {
    slug: "car-dealership",
    sector: "automotive",
    name: "Car dealership",
    phase: 3,
    scope: "professional",
    variants: [v("new-used", "New & used cars"), v("powersports", "Powersports / RV / boat")],
  },

  // Phase 4 — Business tier
  {
    slug: "mining-supply",
    sector: "industrial",
    name: "Mining supply & services",
    phase: 4,
    scope: "standard",
    variants: [],
  },
  {
    slug: "engineering",
    sector: "industrial",
    name: "Engineering consulting",
    phase: 4,
    scope: "professional",
    variants: [],
  },
  {
    slug: "manufacturing",
    sector: "industrial",
    name: "Manufacturing",
    phase: 4,
    scope: "standard",
    variants: [],
  },
  {
    slug: "auto-manufacturer",
    sector: "industrial",
    name: "Auto manufacturer & parts maker",
    phase: 4,
    scope: "standard",
    variants: [],
  },
  {
    slug: "transportation",
    sector: "industrial",
    name: "Transportation & logistics",
    phase: 4,
    scope: "standard",
    variants: [],
  },
  {
    slug: "utilities",
    sector: "community",
    name: "Utilities & telecom",
    phase: 4,
    scope: "standard",
    variants: [],
  },
  {
    slug: "college",
    sector: "education",
    name: "College / university",
    phase: 4,
    scope: "standard",
    variants: [],
  },
];

const bySlug = new Map(packs.map((p) => [p.slug, p]));

export function getPack(slug: string): IndustryPack | undefined {
  return bySlug.get(slug);
}

export function availablePacks(phase: number = AVAILABLE_PHASE): IndustryPack[] {
  return packs.filter((p) => p.phase <= phase);
}

/** True if the pack exists, is released, and (when given) the variant belongs to it. */
export function isSelectable(
  packSlug: string,
  variant?: string | null,
  phase: number = AVAILABLE_PHASE,
): boolean {
  const pack = bySlug.get(packSlug);
  if (!pack || pack.phase > phase) return false;
  if (variant == null) return true;
  return pack.variants.some((x) => x.slug === variant);
}

export {
  getTemplate,
  hasTemplate,
  type IndustryTemplate,
  resolveBehavior,
  type TemplateContent,
  type TemplateWorkflow,
  WORKFLOW_LIMITS,
  type Workflow,
} from "./templates.js";
