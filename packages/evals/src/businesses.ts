import type { EvalBusiness } from "./types.js";

/**
 * The test businesses: set up the way a pilot owner would (profile, services with prices, a page
 * or two of text). Everything here is invented; phone numbers use the 555-01xx range. The text is in
 * English only, like most Ontario businesses, so French questions also test answering in French
 * from English information.
 */

const plumbing: EvalBusiness = {
  key: "trades",
  pack: "trades",
  variant: "plumbing",
  profile: {
    businessName: "Northshore Plumbing & Heating",
    phone: "807-555-0142",
    email: "office@northshore-plumbing.test",
    address: "415 Memorial Ave, Thunder Bay, ON P7B 3Y6",
    bookingUrl: "https://book.northshore-plumbing.test",
    description: "Family-owned plumbing and heating company serving Thunder Bay since 1998.",
    serviceArea: "Thunder Bay, Kakabeka Falls, Shuniah, Neebing and Oliver Paipoonge",
    serviceTowns: ["Thunder Bay", "Kakabeka Falls", "Shuniah", "Neebing", "Oliver Paipoonge"],
    servicePostalPrefixes: ["P7A", "P7B", "P7C", "P7E", "P7G", "P7J", "P7K"],
    credentials:
      "Licensed plumbers, TSSA-registered gas technicians, WSIB covered, $2 million liability insurance",
    hours: {
      mon: [{ open: "08:00", close: "17:00" }],
      tue: [{ open: "08:00", close: "17:00" }],
      wed: [{ open: "08:00", close: "17:00" }],
      thu: [{ open: "08:00", close: "17:00" }],
      fri: [{ open: "08:00", close: "17:00" }],
      sat: [{ open: "09:00", close: "13:00" }],
    },
  },
  catalog: [
    {
      name: "Drain cleaning",
      description: "Kitchen, bathroom and main drains.",
      priceText: "from $149",
      category: "Repairs",
      action: "book",
    },
    {
      name: "Furnace tune-up",
      description: "Cleaning and safety check of a gas furnace.",
      priceText: "$129",
      category: "Heating",
      action: "book",
    },
    {
      name: "Water heater installation",
      description: "Tank and tankless water heaters.",
      priceText: "Call for a quote",
      category: "Installations",
      action: "quote",
    },
    {
      name: "Sump pump installation",
      priceText: "Call for a quote",
      category: "Installations",
      action: "quote",
    },
    { name: "Leak repair", description: "Pipes, faucets and toilets.", category: "Repairs", action: "ask" },
  ],
  knowledge: [
    {
      title: "About us",
      content: `Northshore Plumbing & Heating is a family-owned company founded in 1998 by Dave and Linda Kowalski.
Our team of eight licensed plumbers and TSSA-registered gas technicians works on homes and small businesses.
We install, repair and maintain plumbing, gas furnaces, boilers and water heaters. We do not do air conditioning or duct cleaning.
Our office staff speak English and French.`,
    },
    {
      title: "Emergency service",
      content: `We offer 24/7 emergency service for burst pipes, flooding, sewer backups and no heat. Call 807-555-0142 at any time; after hours the call goes to the technician on duty.
Emergency visits outside regular hours have an after-hours call-out fee of $185, plus parts and labour.
If you smell gas, leave the building right away and call Enbridge Gas at 1-866-763-5427 or 911 from outside. Do not use light switches or phones inside.`,
    },
    {
      title: "Estimates, payment and warranty",
      content: `Estimates for installations (water heaters, sump pumps, boilers, furnaces) are free. For repairs, a diagnostic visit costs $95, which is credited to the repair if you go ahead with it.
We accept Visa, Mastercard, debit and Interac e-Transfer. We do not accept cheques. Payment is due when the work is done.
All our work comes with a one-year warranty on labour. Parts carry the manufacturer's warranty.
Seniors (65 and over) get 10% off labour.`,
    },
    {
      title: "Water heaters",
      content: `We install Bradford White and Rheem tank water heaters and Navien tankless water heaters. A standard tank installation usually takes about four hours.
We do not rent water heaters; we only sell and install them. We remove and recycle your old tank at no extra charge.`,
    },
    {
      title: "Booking",
      content: `Furnace tune-ups and drain cleaning can be booked online at https://book.northshore-plumbing.test. For other work, call us or leave a request and we will call you back within one business day.`,
    },
  ],
};

const tires: EvalBusiness = {
  key: "auto",
  pack: "auto-repair",
  variant: "tires",
  profile: {
    businessName: "Lakehead Auto & Tire",
    phone: "807-555-0187",
    email: "service@lakehead-auto.test",
    address: "1200 Arthur St W, Thunder Bay, ON P7E 5R6",
    bookingUrl: "https://book.lakehead-auto.test",
    description: "Tires, brakes and general repair for cars and light trucks in Thunder Bay.",
    credentials: "Licensed Motor Vehicle Inspection Station (MTO)",
    hours: {
      mon: [{ open: "07:30", close: "18:00" }],
      tue: [{ open: "07:30", close: "18:00" }],
      wed: [{ open: "07:30", close: "18:00" }],
      thu: [{ open: "07:30", close: "18:00" }],
      fri: [{ open: "07:30", close: "18:00" }],
      sat: [{ open: "08:00", close: "16:00" }],
    },
  },
  catalog: [
    {
      name: "Tire changeover",
      description: "Swap of four tires already mounted on rims.",
      priceText: "$80 for 4 tires",
      category: "Tires",
      action: "book",
    },
    {
      name: "Mount and balance",
      description: "Four tires mounted on your rims and balanced.",
      priceText: "$140 for 4 tires",
      category: "Tires",
      action: "book",
    },
    { name: "Seasonal tire storage", priceText: "$99 per season", category: "Tires", action: "ask" },
    {
      name: "Oil change",
      description: "Synthetic blend oil and filter, with a multi-point inspection.",
      priceText: "from $69.95",
      category: "Maintenance",
      action: "book",
    },
    { name: "Wheel alignment", priceText: "$119.95", category: "Maintenance", action: "book" },
    { name: "Brake inspection", priceText: "Free", category: "Brakes", action: "book" },
    {
      name: "Safety inspection (Safety Standards Certificate)",
      priceText: "$120",
      category: "Inspections",
      action: "book",
    },
  ],
  knowledge: [
    {
      title: "About the shop",
      content: `Lakehead Auto & Tire has served Thunder Bay drivers since 2006. We work on cars, SUVs, minivans and light trucks. We do not work on motorcycles, RVs or heavy trucks.
We sell Michelin, Bridgestone, Toyo and Nokian tires, including Nokian Hakkapeliitta winter tires.
For electric vehicles we do tires, brakes and alignments only, not battery or motor repairs.`,
    },
    {
      title: "Appointments and waiting",
      content: `Appointments are recommended, especially for tire changeovers in April and from October to November. Book online at https://book.lakehead-auto.test or call 807-555-0187.
We take walk-ins for tire changeovers when a bay is free, but the wait can be long in the busy season.
A tire changeover takes about 45 minutes. You can wait in our waiting room (free Wi-Fi and coffee) or use our free shuttle anywhere within Thunder Bay city limits.
We do not have courtesy cars or loaner vehicles.`,
    },
    {
      title: "Payment and warranty",
      content: `We accept Visa, Mastercard, American Express, debit and cash. We do not offer financing.
Repairs come with a 12-month / 20,000 km warranty on parts and labour.
Every estimate is given after an inspection of the vehicle; we do not quote repair prices over the phone or by chat.`,
    },
    {
      title: "Towing and breakdowns",
      content: `We do not have a tow truck. If your vehicle has broken down, call CAA (1-800-222-4357) or a towing company and have it towed to 1200 Arthur St W. Let us know it is coming so we can look at it as soon as possible.`,
    },
  ],
};

export const BUSINESSES: Record<string, EvalBusiness> = { trades: plumbing, auto: tires };
