/**
 * Industry templates: a starting point for a new assistant. Creating an assistant copies the
 * template's response guidelines and workflows into it; from then on the business owns that copy
 * and can edit, turn off or delete workflows and write its own. Suggested questions still fall back
 * to the template until the owner writes their own.
 *
 * Platform-wide rules (grounding, no professional advice, safety) live in the chat engine and cannot
 * be changed by templates or businesses.
 *
 * Writing rule for template text: never state facts about a business (lead times, deposits, ages,
 * prices). Steps say what to do "when the business's information gives it", because the assistant
 * may only answer from the business's own information.
 */

import { commonLibrary, industryLibrary } from "./library.js";

/** Limits for a business's workflows (also enforced by the API schema). */
export const WORKFLOW_LIMITS = {
  maxWorkflows: 20,
  maxSteps: 10,
  nameLength: 80,
  whenLength: 300,
  stepLength: 300,
  finishLength: 300,
  guidelinesLength: 4000,
} as const;

/**
 * A playbook the assistant follows when a visitor's request matches `when`: work through the steps
 * (asking for what's missing, a little at a time), then wrap up as `finish` says.
 */
export interface Workflow {
  /** Stable id: the template key for workflows copied from a template, otherwise random. */
  id: string;
  name: string;
  enabled: boolean;
  /** When to use it, e.g. "The visitor asks about a custom or celebration cake". */
  when: string;
  steps: string[];
  /** How to wrap up, e.g. "Share the order link, or the phone number". Empty = no special ending. */
  finish: string;
  /** Template workflow this one was copied from, if any. */
  template?: string;
}

export interface TemplateWorkflow {
  key: string;
  name: string;
  when: string;
  steps: string[];
  finish: string;
  /** Only included for these variants (default: every variant of the template). */
  variants?: string[];
}

export interface IndustryTemplate {
  /** How the assistant responds: focus, tone and industry-specific care points. */
  guidelines: string;
  variantGuidelines?: Record<string, string>;
  quickReplies: Record<"en" | "fr", string[]>;
  workflows: TemplateWorkflow[];
}

/** A workflow the business can add from the library: for its industry, or for any business. */
export type LibraryWorkflow = Workflow & { group: "industry" | "common" };

/** What an assistant gets from its template (and what "reset to template" restores). */
export interface TemplateContent {
  guidelines: string;
  quickReplies: Record<"en" | "fr", string[]>;
  /** Starter workflows, copied into a new assistant. */
  workflows: Workflow[];
  /**
   * Every workflow the business can pick from: the starters, more for its industry, then ones for
   * any business. Ids are unique.
   */
  library: LibraryWorkflow[];
}

const lines = (...xs: string[]) => xs.join("\n");

const templates: Record<string, IndustryTemplate> = {
  restaurant: {
    guidelines: lines(
      "You help guests of a restaurant or bar with hours, menu, prices, reservations, takeout/delivery, parking, accessibility and events.",
      "Allergens and dietary needs: answer only from the business's menu information, and always add that guests should confirm with staff before ordering.",
      "If reservation or online-ordering links are known, offer them.",
    ),
    variantGuidelines: {
      pub: "Alcohol is only served to guests 19 and older (Ontario).",
    },
    quickReplies: {
      en: ["What are your hours?", "Can I see the menu?", "Do you take reservations?"],
      fr: ["Quelles sont vos heures?", "Puis-je voir le menu?", "Prenez-vous les réservations?"],
    },
    workflows: [
      {
        key: "reservation",
        name: "Table reservation",
        when: "The visitor wants to book a table or asks about reservations.",
        steps: [
          "If the business takes reservations through a booking link, offer it right away.",
          "Otherwise ask for the date, time and number of guests.",
          "Check the request against the opening hours and mention any reservation policy from the business's information (large groups, deposits, cancellations).",
        ],
        finish:
          "Share the booking link, or the phone number to confirm. Never confirm a reservation yourself.",
      },
      {
        key: "dietary",
        name: "Allergies and dietary needs",
        when: "The visitor mentions an allergy, intolerance or diet (vegan, gluten-free, halal…).",
        steps: [
          "Point to dishes the menu information marks as suitable, if any.",
          "Don't guess about ingredients that aren't listed.",
        ],
        finish: "Always remind them to tell staff about the allergy before ordering.",
      },
      {
        key: "takeout",
        name: "Takeout and delivery",
        when: "The visitor wants to order takeout or delivery.",
        steps: [
          "Say whether takeout or delivery is offered, based on the business's information.",
          "Mention delivery areas, fees or partner apps only if they're in the information.",
        ],
        finish: "Share the online-ordering link, or the phone number to order.",
      },
    ],
  },
  "cafe-bakery": {
    guidelines: lines(
      "You help customers of a café or bakery with hours, menu, custom orders (cakes, catering), pre-orders and pickup.",
      "Allergens: answer only from the business's information and add that customers should confirm with staff.",
    ),
    quickReplies: {
      en: ["What are your hours?", "Do you make custom cakes?", "Do you have gluten-free options?"],
      fr: [
        "Quelles sont vos heures?",
        "Faites-vous des gâteaux sur mesure?",
        "Avez-vous des options sans gluten?",
      ],
    },
    workflows: [
      {
        key: "custom-order",
        name: "Custom cake or catering order",
        when: "The visitor asks about a custom cake, celebration order or catering.",
        steps: [
          "Ask for the date they need it and roughly how many people it's for.",
          "Mention the lead time, deposit and sizes when the business's information gives them.",
          "Ask about flavours, design ideas and any dietary needs.",
        ],
        finish: "Explain how to place the order (order link, email or phone) and summarise their details.",
      },
      {
        key: "dietary",
        name: "Allergies and dietary needs",
        when: "The visitor mentions an allergy, intolerance or diet.",
        steps: ["Point to items the business's information marks as suitable, if any."],
        finish: "Remind them to confirm with staff before ordering.",
      },
    ],
  },
  retail: {
    guidelines: lines(
      "You help shoppers of a retail store with hours, location, products, services, returns, shipping and gift cards.",
      "Never invent stock levels or prices. If availability isn't in the information, suggest calling or visiting the store.",
    ),
    variantGuidelines: {
      florist:
        "For deliveries, mention order cut-off times and delivery areas when the information is available.",
    },
    quickReplies: {
      en: ["What are your hours?", "Where are you located?", "What is your return policy?"],
      fr: ["Quelles sont vos heures?", "Où êtes-vous situés?", "Quelle est votre politique de retour?"],
    },
    workflows: [
      {
        key: "product-availability",
        name: "Is this in stock?",
        when: "The visitor asks whether a product, size or brand is available.",
        steps: [
          "Say whether the store carries that kind of product, based on the business's information.",
          "Don't promise current stock.",
        ],
        finish: "Suggest calling or visiting to check stock, and give the phone number.",
      },
      {
        key: "returns",
        name: "Returns and exchanges",
        when: "The visitor wants to return or exchange an item.",
        steps: [
          "Explain the return policy from the business's information (time limit, receipt, condition).",
          "Ask whether they bought it in store or online if the policy differs.",
        ],
        finish: "Tell them how to start the return (bring it in, email or phone).",
      },
      {
        key: "flower-delivery",
        name: "Flower delivery",
        when: "The visitor wants flowers delivered.",
        variants: ["florist"],
        steps: [
          "Ask for the delivery date and the delivery town or area.",
          "Mention cut-off times, delivery areas and fees when the business's information gives them.",
        ],
        finish: "Share the ordering link, or the phone number to place the order.",
      },
    ],
  },
  "personal-care": {
    guidelines: lines(
      "You help clients of a salon, spa or barber shop with services, prices, booking, cancellation policy and preparation.",
      "Do not give medical or skin-condition advice; suggest a consultation instead.",
    ),
    variantGuidelines: {
      "tattoo-piercing":
        "Clients must be 18 or older (or follow the studio's stated policy). Explain consultations, deposits and aftercare only as described by the studio.",
    },
    quickReplies: {
      en: ["How do I book?", "What are your prices?", "What is your cancellation policy?"],
      fr: [
        "Comment prendre rendez-vous?",
        "Quels sont vos prix?",
        "Quelle est votre politique d'annulation?",
      ],
    },
    workflows: [
      {
        key: "booking",
        name: "Book an appointment",
        when: "The visitor wants to book an appointment.",
        steps: [
          "Ask which service they'd like, if they haven't said.",
          "Give the price and duration when the business's information has them.",
          "Mention the cancellation or deposit policy if there is one.",
        ],
        finish: "Share the booking link, or the phone number to book.",
      },
      {
        key: "consultation",
        name: "Tattoo or piercing consultation",
        when: "The visitor wants a tattoo or piercing, or asks about a consultation.",
        variants: ["tattoo-piercing"],
        steps: [
          "Ask about the idea, size and placement in general terms.",
          "Explain consultations and deposits only as the studio describes them.",
          "Mention the age policy.",
        ],
        finish: "Explain how to request a consultation (booking link, email or phone).",
      },
    ],
  },
  lodging: {
    guidelines: lines(
      "You help guests of a motel, B&B, lodge or small hotel with rooms, rates, availability, check-in/check-out, amenities, pets, parking and local tips.",
      "Never confirm a reservation or guarantee availability yourself; point to the booking link or phone number.",
    ),
    quickReplies: {
      en: ["What time is check-in?", "Do you allow pets?", "How do I book a room?"],
      fr: ["À quelle heure est l'arrivée?", "Acceptez-vous les animaux?", "Comment réserver une chambre?"],
    },
    workflows: [
      {
        key: "room-booking",
        name: "Room booking",
        when: "The visitor wants to book a room or asks about availability.",
        steps: [
          "Ask for the dates and number of guests.",
          "Describe room types and rates from the business's information, if any.",
          "Mention pet, parking or minimum-stay policies that apply.",
        ],
        finish: "Share the booking link, or the phone number. Don't promise availability.",
      },
    ],
  },
  attractions: {
    guidelines: lines(
      "You help visitors of an attraction, tour or recreation business with schedules, tickets, prices, conditions, what to bring and directions.",
      "Conditions (weather, snow, trails) change often: only state conditions given in the business's information and suggest checking before coming.",
    ),
    quickReplies: {
      en: ["Are you open today?", "How much are tickets?", "What should I bring?"],
      fr: ["Êtes-vous ouverts aujourd'hui?", "Combien coûtent les billets?", "Que dois-je apporter?"],
    },
    workflows: [
      {
        key: "plan-visit",
        name: "Plan a visit",
        when: "The visitor is planning a visit, tour or activity.",
        steps: [
          "Ask the date and how many people (and ages, if prices or rules depend on it).",
          "Give hours, prices and what to bring from the business's information.",
          "Remind them that conditions can change and suggest checking before coming.",
        ],
        finish: "Share the ticket or booking link, or the phone number.",
      },
      {
        key: "group-booking",
        name: "Group or private booking",
        when: "The visitor asks about a group, school, corporate or private booking.",
        steps: [
          "Ask for the date, group size and type of group.",
          "Mention group rates or minimums only if they're in the business's information.",
        ],
        finish: "Explain how to request a group booking (email or phone) and summarise their details.",
      },
    ],
  },
  generic: {
    guidelines:
      "You help customers of a local business with questions about its services, hours, location, prices and how to get in touch.",
    quickReplies: {
      en: ["What are your hours?", "What services do you offer?", "How can I contact you?"],
      fr: ["Quelles sont vos heures?", "Quels services offrez-vous?", "Comment vous joindre?"],
    },
    workflows: [
      {
        key: "contact-request",
        name: "Get in touch",
        when: "The visitor wants to talk to someone, get a quote, or asks something you can't answer.",
        steps: ["Ask briefly what it's about, so you can point them to the right contact."],
        finish: "Give the phone number or email, and the opening hours if they're known.",
      },
    ],
  },
};

const generic = templates.generic!;

const forVariant = (variant: string | null | undefined) => (w: TemplateWorkflow) =>
  !w.variants || (variant != null && w.variants.includes(variant));

/** A fresh copy (callers may edit it) of a template workflow, ready to store on an assistant. */
const toWorkflow = ({ key, name, when, steps, finish }: TemplateWorkflow): Workflow => ({
  id: key,
  name,
  enabled: true,
  when,
  steps: [...steps],
  finish,
  template: key,
});

/** The template for an industry (and variant), as copied into a new assistant. */
export function getTemplate(slug: string, variant?: string | null): TemplateContent {
  const t = templates[slug] ?? generic;
  const extra = variant ? t.variantGuidelines?.[variant] : undefined;
  const starters = t.workflows.filter(forVariant(variant));
  const industry = [...starters, ...(industryLibrary[slug] ?? industryLibrary.generic!)].filter(
    forVariant(variant),
  );
  const seen = new Set<string>();
  const library: LibraryWorkflow[] = [];
  for (const [group, list] of [
    ["industry", industry],
    ["common", commonLibrary],
  ] as const) {
    for (const w of list) {
      if (seen.has(w.key)) continue;
      seen.add(w.key);
      library.push({ ...toWorkflow(w), group });
    }
  }
  return {
    guidelines: extra ? `${t.guidelines}\n${extra}` : t.guidelines,
    quickReplies: t.quickReplies,
    workflows: starters.map(toWorkflow),
    library,
  };
}

/** True if the industry has its own template (otherwise the generic one is used). */
export function hasTemplate(slug: string): boolean {
  return slug in templates;
}

/**
 * What an assistant actually uses. Assistants created before templates were copied have no
 * guidelines/workflows of their own (null) and keep following their template until edited.
 */
export function resolveBehavior(bot: {
  pack: string;
  variant: string | null;
  guidelines: string | null;
  workflows: Workflow[] | null;
}): { guidelines: string; workflows: Workflow[] } {
  if (bot.guidelines != null && bot.workflows != null) {
    return { guidelines: bot.guidelines, workflows: bot.workflows };
  }
  const t = getTemplate(bot.pack, bot.variant);
  return { guidelines: bot.guidelines ?? t.guidelines, workflows: bot.workflows ?? t.workflows };
}
