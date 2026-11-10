/**
 * Workflow library: extra workflows a business can add from its admin, on top of the starter
 * workflows its template copies in (templates.ts). `industryLibrary` is per industry template;
 * `commonLibrary` suits any business.
 *
 * Same writing rule as templates: never state facts about a business. Steps say what to do "when
 * the business's information gives it".
 */
import type { TemplateWorkflow } from "./templates.js";

export const commonLibrary: TemplateWorkflow[] = [
  {
    key: "contact-request",
    name: "Get in touch",
    when: "The visitor wants to talk to someone, or asks something you can't answer.",
    steps: ["Ask briefly what it's about, so you can point them to the right contact."],
    finish: "Give the phone number or email, and the opening hours if they're known.",
  },
  {
    key: "open-now",
    name: "Are you open?",
    when: "The visitor asks if the business is open now, today or on a specific day.",
    steps: [
      "Compare the current local time and day with the opening hours.",
      "Mention holiday or seasonal hours if the business's information gives them.",
      "If the hours aren't known for that day, say so instead of guessing.",
    ],
    finish: "If they plan to come on a holiday or the hours are unclear, suggest calling first.",
  },
  {
    key: "directions",
    name: "Directions and parking",
    when: "The visitor asks where the business is, how to get there, or about parking.",
    steps: [
      "Give the address.",
      "Mention parking, transit and accessible entrances when the business's information covers them.",
    ],
    finish: "Share the website or map link if one is in the business's information.",
  },
  {
    key: "feedback",
    name: "Complaint or feedback",
    when: "The visitor is unhappy, wants to complain, or wants to leave feedback.",
    steps: [
      "Thank them and acknowledge how they feel, without arguing.",
      "Ask briefly what happened and when.",
      "Don't promise refunds, discounts or compensation.",
    ],
    finish: "Give the email or phone number so the business can follow up personally.",
  },
  {
    key: "price-question",
    name: "Prices and quotes",
    when: "The visitor asks how much something costs.",
    steps: [
      "Give prices listed in the business's information.",
      "If the price isn't listed or depends on the job, say so and ask what they need.",
    ],
    finish: "Explain how to get an exact price or quote (email, phone or quote form).",
  },
  {
    key: "gift-cards",
    name: "Gift cards",
    when: "The visitor asks about gift cards or gift certificates.",
    steps: [
      "Say whether gift cards are offered, based on the business's information.",
      "Mention where to buy them (in store or online) when it's known.",
    ],
    finish: "For balances or lost cards, give the phone number or email.",
  },
  {
    key: "jobs",
    name: "Job opportunities",
    when: "The visitor asks about jobs, hiring or how to apply.",
    steps: [
      "Share open positions or a careers page if the business's information lists them.",
      "Don't collect résumés or personal details in the chat.",
    ],
    finish: "Explain how to apply (careers page, email or in person).",
  },
  {
    key: "lost-found",
    name: "Lost and found",
    when: "The visitor left or lost something at the business.",
    steps: ["Ask what the item is and roughly when they visited."],
    finish: "Give the phone number so staff can check. Don't say whether the item was found.",
  },
];

export const industryLibrary: Record<string, TemplateWorkflow[]> = {
  trades: [
    {
      key: "maintenance",
      name: "Seasonal maintenance and tune-ups",
      when: "The visitor asks about a furnace or air-conditioner tune-up, seasonal maintenance or a maintenance plan.",
      steps: [
        "Describe maintenance services and plans from the business's information, with prices if they're listed.",
        "Ask what equipment they have and when it was last serviced, if they know.",
      ],
      finish: "Share the booking link, or take their details so the business can schedule it.",
    },
    {
      key: "seasonal-contract",
      name: "Lawn care or snow removal contract",
      when: "The visitor asks about a seasonal or recurring contract for lawn care or snow removal.",
      variants: ["landscaping-snow"],
      steps: [
        "Ask for the address or town, whether it is a home or a business, and the size of the lawn, driveway or lot.",
        "Describe what the contract covers and when sign-up opens or closes, only from the business's information.",
      ],
      finish: "Take their details so the business can send a quote.",
    },
    {
      key: "after-job",
      name: "Problem after a recent job",
      when: "The visitor says a recent repair or installation by the business isn't working, or asks about the warranty on it.",
      steps: [
        "Ask what was done, roughly when, and what is happening now.",
        "Explain the warranty or guarantee only as the business's information describes it.",
        "Don't admit fault or promise a free repair.",
      ],
      finish: "Take their name, phone number and address so the business can follow up.",
    },
    {
      key: "change-visit",
      name: "Change or cancel a visit",
      when: "The visitor wants to reschedule or cancel a booked visit.",
      steps: [
        "Explain the cancellation policy from the business's information, if there is one.",
        "You can't see or change bookings yourself.",
      ],
      finish: "Give the phone number, or pass on their request with the date of the visit.",
    },
    {
      key: "financing-rebates",
      name: "Financing and rebates",
      when: "The visitor asks about financing, payment plans, or government or utility rebates.",
      steps: [
        "Share financing options and rebate help only as the business's information describes them.",
        "Don't say whether they qualify for a rebate or for financing.",
      ],
      finish: "Suggest asking for the details with their quote, and give the phone number or email.",
    },
    {
      key: "licences-insurance",
      name: "Licences and insurance",
      when: "The visitor asks whether the business is licensed, insured or certified.",
      steps: [
        "Share the licences, certifications and insurance listed in the business's information.",
        "If it isn't listed, say you don't have that information rather than guessing.",
      ],
      finish: "Give the phone number or email for proof of insurance or licence numbers.",
    },
  ],
  "auto-repair": [
    {
      key: "repair-estimate",
      name: "Repair estimate",
      when: "The visitor asks how much a repair or service will cost.",
      steps: [
        "Ask for the year, make and model and what needs doing.",
        "Give prices only for services listed in the business's information.",
        "Say the final estimate follows an inspection.",
      ],
      finish: "Offer to book an inspection, or give the phone number.",
    },
    {
      key: "tire-storage",
      name: "Tire storage",
      when: "The visitor asks about storing their tires at the shop.",
      steps: ["Say whether storage is offered, and the price, from the business's information."],
      finish: "Explain how to arrange it (at the changeover appointment, or by phone).",
    },
    {
      key: "drop-off",
      name: "Drop-off, shuttle and loaner car",
      when: "The visitor asks about dropping the vehicle off after hours, a key drop, a shuttle, a loaner car or waiting at the shop.",
      steps: [
        "Explain what's offered only from the business's information.",
        "If it isn't covered, say so rather than guessing.",
      ],
      finish: "Suggest asking when they book, and give the phone number.",
    },
    {
      key: "repair-warranty",
      name: "Warranty on a repair",
      when: "The visitor asks about the warranty on parts or labour, or says a problem came back after a repair.",
      steps: [
        "Explain the warranty only as the business's information describes it.",
        "Ask what was done, roughly when, and what is happening now.",
        "Don't admit fault or promise a free repair.",
      ],
      finish: "Take their details so the shop can follow up, or give the phone number.",
    },
    {
      key: "insurance-claim",
      name: "Insurance claim",
      when: "The visitor has, or asks about, an insurance claim for collision or glass damage.",
      variants: ["body-collision", "glass"],
      steps: [
        "Ask whether a claim has been opened, without asking for policy or claim numbers.",
        "Explain how the shop works with insurers only as the business's information describes it.",
        "Don't say what the insurer will pay.",
      ],
      finish: "Explain how to get an estimate (booking link, phone or bringing the vehicle in).",
    },
    {
      key: "inspection",
      name: "Safety inspection or certificate",
      when: "The visitor asks about a safety inspection, a safety certificate or an emissions test.",
      steps: [
        "Say whether the shop does that inspection, and the price, from the business's information.",
        "Don't say whether the vehicle will pass.",
      ],
      finish: "Share the booking link, or the phone number.",
    },
    {
      key: "breakdown",
      name: "Breakdown or towing",
      when: "The visitor's vehicle won't start, has broken down or needs a tow.",
      steps: [
        "If they are somewhere unsafe or someone is hurt, tell them to call 911 first.",
        "Say whether the shop offers or arranges towing, based on the business's information.",
      ],
      finish: "Give the phone number right away.",
    },
  ],
  restaurant: [
    {
      key: "private-event",
      name: "Private events and large groups",
      when: "The visitor wants to book for a large group or a private event (birthday, work party…).",
      steps: [
        "Ask for the date, number of guests and type of event.",
        "Mention private rooms, set menus, minimums or deposits when the business's information gives them.",
      ],
      finish: "Explain how to request the booking (email or phone) and summarise their details.",
    },
    {
      key: "catering",
      name: "Catering",
      when: "The visitor asks about catering or food for an event elsewhere.",
      steps: [
        "Say whether catering is offered, based on the business's information.",
        "Ask for the date, number of people and location.",
        "Mention catering menus and lead times when the information gives them.",
      ],
      finish: "Share the catering menu or form if there is one, or the email or phone number.",
    },
    {
      key: "menu-help",
      name: "Help choosing a dish",
      when: "The visitor asks what's good, what to order or for a recommendation.",
      steps: [
        "Ask what they feel like (or any dietary needs, spice level, budget).",
        "Suggest two or three dishes from the menu information that match, with prices if listed.",
      ],
      finish: "",
    },
    {
      key: "families",
      name: "Visiting with kids",
      when: "The visitor asks if the restaurant is family-friendly or has a kids' menu.",
      steps: [
        "Mention the kids' menu, high chairs or change tables only if the business's information lists them.",
      ],
      finish: "If it isn't covered, suggest calling to check.",
    },
    {
      key: "events",
      name: "Events and specials",
      when: "The visitor asks about live music, trivia nights, specials or what's on.",
      steps: [
        "List upcoming events or regular specials from the business's information.",
        "If nothing is listed, say so rather than guessing.",
      ],
      finish: "Point to the website or social media pages if they're in the business's information.",
    },
  ],
  "cafe-bakery": [
    {
      key: "pre-order",
      name: "Order ahead and pickup",
      when: "The visitor wants to order ahead, pre-order or pick up an order.",
      steps: [
        "Say whether pre-orders are taken, and how, based on the business's information.",
        "Mention order cut-off times and pickup hours when they're given.",
      ],
      finish: "Share the ordering link, or the phone number.",
    },
    {
      key: "wholesale",
      name: "Wholesale or office orders",
      when: "The visitor asks about wholesale, office or recurring orders.",
      steps: [
        "Ask what they're looking for and roughly how much or how often.",
        "Mention wholesale terms only if the business's information gives them.",
      ],
      finish: "Give the email or phone number for wholesale enquiries.",
    },
    {
      key: "whats-fresh",
      name: "What's available today",
      when: "The visitor asks what's fresh, sold out or available today.",
      steps: [
        "Share daily items or baking schedules from the business's information, if any.",
        "Don't promise anything is still in stock.",
      ],
      finish: "Suggest calling to check before coming for a specific item.",
    },
    {
      key: "coffee-beans",
      name: "Buying beans and subscriptions",
      when: "The visitor asks about buying coffee beans, grinding or a subscription.",
      variants: ["coffee-roaster", "cafe"],
      steps: [
        "Describe the coffees, grind options and subscriptions listed in the business's information.",
        "Ask how they brew if they want help choosing.",
      ],
      finish: "Share the online shop link, or explain how to buy in store.",
    },
  ],
  retail: [
    {
      key: "special-order",
      name: "Special order or hold an item",
      when: "The visitor wants to order something the store doesn't have, or put an item on hold.",
      steps: [
        "Ask what item they want (brand, model, size or colour).",
        "Mention special-order or hold policies (deposit, how long) when the business's information gives them.",
      ],
      finish: "Give the phone number or email to place the order or hold.",
    },
    {
      key: "gift-help",
      name: "Help finding a gift",
      when: "The visitor is looking for a gift idea.",
      steps: [
        "Ask who it's for, the occasion and a rough budget.",
        "Suggest kinds of products the store carries that fit, based on the business's information.",
      ],
      finish: "Mention gift cards or gift wrapping if the store offers them.",
    },
    {
      key: "shipping",
      name: "Shipping and online orders",
      when: "The visitor asks about shipping, delivery or an online order.",
      steps: [
        "Explain shipping areas, costs and times from the business's information.",
        "For a specific order's status, don't guess: you can't see orders.",
      ],
      finish: "Give the email or phone number for order questions.",
    },
    {
      key: "services",
      name: "Services and repairs",
      when: "The visitor asks about a service such as repairs, alterations, engraving or installation.",
      steps: [
        "Say whether the store offers that service, based on the business's information.",
        "Ask what they need done and mention prices or turnaround times if listed.",
      ],
      finish: "Explain how to drop off or book the service, or give the phone number.",
    },
  ],
  "personal-care": [
    {
      key: "first-visit",
      name: "First visit",
      when: "The visitor is a new client or asks what to expect on a first visit.",
      steps: [
        "Ask which service they're interested in.",
        "Explain what to expect, how early to arrive and how to prepare, from the business's information.",
        "Mention new-client offers only if the information lists them.",
      ],
      finish: "Share the booking link, or the phone number.",
    },
    {
      key: "service-menu",
      name: "Choosing a service",
      when: "The visitor isn't sure which service or treatment to book.",
      steps: [
        "Ask what result they're hoping for (and hair length or type, if prices depend on it).",
        "Suggest matching services from the service menu with prices and durations if listed.",
        "Don't give medical or skin-condition advice; suggest a consultation instead.",
      ],
      finish: "Share the booking link, or suggest a consultation.",
    },
    {
      key: "group-booking",
      name: "Wedding or group booking",
      when: "The visitor asks about a wedding party, event or booking for several people.",
      steps: [
        "Ask for the date, number of people and services wanted.",
        "Mention on-site services, deposits or packages only if the business's information gives them.",
      ],
      finish: "Explain how to request a group booking (email or phone) and summarise their details.",
    },
    {
      key: "late-cancel",
      name: "Running late or cancelling",
      when: "The visitor is running late, needs to cancel or wants to reschedule.",
      steps: [
        "Explain the late arrival and cancellation policy from the business's information.",
        "You can't change bookings yourself.",
      ],
      finish: "Give the phone number, or the booking link to reschedule.",
    },
  ],
  lodging: [
    {
      key: "arrival",
      name: "Arrival and check-in",
      when: "The visitor asks about check-in, late arrival, keys or check-out.",
      steps: [
        "Give check-in and check-out times from the business's information.",
        "Explain late arrival or self check-in arrangements when they're described.",
      ],
      finish: "For a late arrival, suggest calling ahead and give the phone number.",
    },
    {
      key: "pets",
      name: "Travelling with pets",
      when: "The visitor asks whether they can bring a pet.",
      steps: [
        "Explain the pet policy (allowed rooms, fees, size limits) from the business's information.",
        "If the policy isn't given, say so instead of guessing.",
      ],
      finish: "Suggest mentioning the pet when booking, and give the phone number.",
    },
    {
      key: "local-tips",
      name: "Things to do nearby",
      when: "The visitor asks about restaurants, attractions or activities near the property.",
      steps: [
        "Share local tips only from the business's information.",
        "Don't recommend places that aren't mentioned there.",
      ],
      finish: "Suggest asking the front desk on arrival for more ideas.",
    },
    {
      key: "group-stay",
      name: "Group or long stay",
      when: "The visitor asks about booking several rooms, a work crew or a long stay.",
      steps: [
        "Ask for the dates, number of rooms or guests, and purpose of the stay.",
        "Mention group or weekly rates only if the business's information gives them.",
      ],
      finish: "Explain how to request the booking (email or phone) and summarise their details.",
    },
    {
      key: "change-booking",
      name: "Change or cancel a booking",
      when: "The visitor wants to change or cancel a reservation.",
      steps: [
        "Explain the cancellation policy from the business's information.",
        "You can't see or change bookings yourself.",
      ],
      finish: "Give the phone number or email, or the booking site where they reserved.",
    },
  ],
  attractions: [
    {
      key: "conditions",
      name: "Today's conditions",
      when: "The visitor asks about current conditions (snow, trails, water, weather) or closures.",
      steps: [
        "Share conditions only from the business's information, and when they were last updated if known.",
        "Remind them that conditions change quickly.",
      ],
      finish: "Point to the conditions page or social media, or suggest calling before coming.",
    },
    {
      key: "birthday-party",
      name: "Birthday parties",
      when: "The visitor asks about hosting a birthday party.",
      steps: [
        "Ask for the date, the age of the birthday child and number of guests.",
        "Describe party packages and prices only as the business's information gives them.",
      ],
      finish: "Explain how to book the party (booking link, email or phone).",
    },
    {
      key: "rentals",
      name: "Equipment rental",
      when: "The visitor asks about renting equipment (skis, bikes, canoes, clubs…).",
      steps: [
        "Say what can be rented and the prices, based on the business's information.",
        "Ask for sizes or number of people only if that matters for booking.",
      ],
      finish: "Share the rental booking link, or the phone number.",
    },
    {
      key: "accessibility",
      name: "Accessibility",
      when: "The visitor asks about wheelchair access, mobility or other accessibility needs.",
      steps: [
        "Share accessibility details from the business's information.",
        "If they aren't covered, say so rather than guessing.",
      ],
      finish: "Give the phone number so staff can help them plan.",
    },
  ],
  generic: [
    {
      key: "quote-request",
      name: "Request a quote",
      when: "The visitor wants a quote or estimate.",
      steps: [
        "Ask what they need done, where, and by when.",
        "Mention typical prices only if the business's information lists them.",
      ],
      finish: "Explain how to request the quote (form, email or phone) and summarise their details.",
    },
    {
      key: "appointment",
      name: "Book an appointment",
      when: "The visitor wants to book an appointment or meeting.",
      steps: [
        "Ask what the appointment is for.",
        "Mention availability or lead times only if the business's information gives them.",
      ],
      finish: "Share the booking link, or the phone number. Never confirm a booking yourself.",
    },
    {
      key: "service-area",
      name: "Do you serve my area?",
      when: "The visitor asks whether the business serves their town or area.",
      steps: [
        "Ask for their town or area if they haven't said.",
        "Check it against the service areas in the business's information.",
      ],
      finish: "If the area isn't listed, suggest calling to check.",
    },
  ],
};
