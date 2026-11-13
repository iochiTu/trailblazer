import type { Localized } from "./site.js";

/**
 * Cities with their own landing pages. To add one, add an entry here: the pages, sitemap, llms.txt
 * and the MCP server pick it up. Write only what is true of the place and easy to check (where it
 * is, the communities around it, the languages spoken): never claims about customers or results.
 */
export interface City {
  /** URL part, lowercase with hyphens. */
  slug: string;
  name: Localized;
  /** Province code for structured data. */
  province: "ON";
  region: Localized;
  /** One or two sentences that place the city, used in the page's opening. */
  about: Localized;
  /** What the seasons and the setting mean for local businesses' customer questions. */
  context: Localized;
  /** Communities around the city that local businesses commonly serve. */
  nearby: string[];
  /** Other names people search for, matched by the "is this city served" check. */
  aliases?: string[];
}

export const cities: City[] = [
  {
    slug: "thunder-bay",
    name: { en: "Thunder Bay", fr: "Thunder Bay" },
    province: "ON",
    region: { en: "Northwestern Ontario", fr: "Nord-Ouest de l'Ontario" },
    about: {
      en: "Thunder Bay sits on the north shore of Lake Superior and is the largest city in Northwestern Ontario, the service centre for a very wide area.",
      fr: "Thunder Bay est située sur la rive nord du lac Supérieur. C'est la plus grande ville du Nord-Ouest de l'Ontario et le centre de services d'un très vaste territoire.",
    },
    context: {
      en: "Customers often drive in from well outside the city, so the first thing they ask is whether you serve their area and when you are open. Long winters bring the same questions in waves: heating and frozen pipes, snow clearing, and the fall rush for winter tires.",
      fr: "Les clients viennent souvent de bien au-delà de la ville : ils demandent d'abord si vous desservez leur secteur et quand vous êtes ouverts. Les longs hivers ramènent les mêmes questions par vagues : chauffage et tuyaux gelés, déneigement, et la ruée d'automne pour les pneus d'hiver.",
    },
    nearby: ["Kakabeka Falls", "Shuniah", "Neebing", "Oliver Paipoonge"],
  },
  {
    slug: "sudbury",
    name: { en: "Greater Sudbury", fr: "Sudbury" },
    province: "ON",
    region: { en: "Northeastern Ontario", fr: "Nord-Est de l'Ontario" },
    about: {
      en: "Greater Sudbury is the largest city in Northern Ontario, spread over many communities and lakes, with one of the province's largest French-speaking communities.",
      fr: "Le Grand Sudbury est la plus grande ville du Nord de l'Ontario, répartie sur de nombreuses collectivités et de nombreux lacs, et abrite l'une des plus grandes communautés francophones de la province.",
    },
    context: {
      en: "Many customers expect to be served in French as easily as in English. The city covers a large area, so questions about which communities you serve, travel and winter conditions come up every day.",
      fr: "Beaucoup de clients s'attendent à être servis en français aussi facilement qu'en anglais. La ville couvre un grand territoire : les questions sur les secteurs desservis, les déplacements et les conditions hivernales reviennent chaque jour.",
    },
    nearby: ["Val Caron", "Chelmsford", "Lively", "Hanmer"],
    aliases: ["Sudbury", "Grand Sudbury"],
  },
  {
    slug: "sault-ste-marie",
    name: { en: "Sault Ste. Marie", fr: "Sault-Sainte-Marie" },
    province: "ON",
    region: { en: "Northern Ontario", fr: "Nord de l'Ontario" },
    about: {
      en: "Sault Ste. Marie lies on the St. Marys River, across the International Bridge from Michigan, between Lake Superior and Lake Huron.",
      fr: "Sault-Sainte-Marie se trouve sur la rivière St. Marys, en face du Michigan par le pont international, entre le lac Supérieur et le lac Huron.",
    },
    context: {
      en: "As a border city on the Trans-Canada Highway, it sees travellers and visitors alongside regulars, who ask about hours, directions and what you offer before they stop. Lake-effect snow makes winter services a busy season.",
      fr: "Ville frontalière sur la Transcanadienne, elle accueille des voyageurs et des visiteurs en plus des habitués : ils demandent vos heures, votre emplacement et ce que vous offrez avant de s'arrêter. La neige d'effet de lac fait de l'hiver une saison chargée.",
    },
    nearby: ["Echo Bay", "Goulais River", "Prince Township"],
    aliases: ["Sault Sainte Marie", "Sault Saint Marie", "The Soo", "Sault-Sainte-Marie"],
  },
  {
    slug: "north-bay",
    name: { en: "North Bay", fr: "North Bay" },
    province: "ON",
    region: { en: "Northeastern Ontario", fr: "Nord-Est de l'Ontario" },
    about: {
      en: "North Bay sits between Lake Nipissing and Trout Lake, where Highways 11 and 17 meet, and is often called the gateway to Northern Ontario.",
      fr: "North Bay se trouve entre le lac Nipissing et le lac Trout, à la rencontre des routes 11 et 17 : on l'appelle souvent la porte d'entrée du Nord de l'Ontario.",
    },
    context: {
      en: "People passing through on the highway, cottagers and year-round residents all look you up on their phones first. Clear answers about hours, location and booking decide whether they stop.",
      fr: "Les gens de passage sur la route, les villégiateurs et les résidents à l'année vous cherchent d'abord sur leur téléphone. Des réponses claires sur les heures, l'emplacement et les réservations décident s'ils s'arrêtent.",
    },
    nearby: ["Callander", "East Ferris", "Powassan"],
  },
  {
    slug: "timmins",
    name: { en: "Timmins", fr: "Timmins" },
    province: "ON",
    region: { en: "Northeastern Ontario", fr: "Nord-Est de l'Ontario" },
    about: {
      en: "Timmins is a mining city in Northeastern Ontario and a regional centre for the communities along Highway 101, with a large French-speaking population.",
      fr: "Timmins est une ville minière du Nord-Est de l'Ontario et un centre régional pour les collectivités le long de la route 101, avec une importante population francophone.",
    },
    context: {
      en: "A large share of customers speak French at home, and in a mining city many people work shifts and look things up outside office hours. Winters are long and cold, so heating, vehicles and snow are constant topics.",
      fr: "Une grande part des clients parlent français à la maison et, dans une ville minière, beaucoup travaillent par quarts et s'informent en dehors des heures de bureau. Les hivers sont longs et froids : chauffage, véhicules et neige reviennent sans cesse.",
    },
    nearby: ["South Porcupine", "Schumacher", "Porcupine"],
  },
  {
    slug: "kenora",
    name: { en: "Kenora", fr: "Kenora" },
    province: "ON",
    region: { en: "Northwestern Ontario", fr: "Nord-Ouest de l'Ontario" },
    about: {
      en: "Kenora is on the north shore of Lake of the Woods in Northwestern Ontario, close to the Manitoba border.",
      fr: "Kenora se trouve sur la rive nord du lac des Bois, dans le Nord-Ouest de l'Ontario, près de la frontière du Manitoba.",
    },
    context: {
      en: "Summer brings cottagers and visitors to the lake, many of them from Manitoba, and they ask about hours, bookings and what is open before they arrive. A small team can be stretched thin in those months.",
      fr: "L'été amène au lac des villégiateurs et des visiteurs, souvent du Manitoba : ils demandent les heures, les réservations et ce qui est ouvert avant d'arriver. Une petite équipe est vite débordée durant ces mois.",
    },
    nearby: ["Keewatin", "Sioux Narrows", "Minaki"],
  },
];

export function getCity(slug: string): City | undefined {
  return cities.find((c) => c.slug === slug);
}

/** Lowercase, no accents or punctuation, so "Sault Ste. Marie" and "sault ste marie" match. */
export function normalizePlace(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Finds a listed city by name, alias, slug, or one of the communities around it. */
export function findCity(query: string): { city: City; via: "city" | "nearby" } | undefined {
  // Drop a trailing province ("Thunder Bay, ON").
  const wanted = normalizePlace(query).replace(/ (on|ont|ontario)$/, "");
  if (!wanted) return undefined;
  for (const city of cities) {
    const names = [city.slug, city.name.en, city.name.fr, ...(city.aliases ?? [])].map(normalizePlace);
    if (names.includes(wanted)) return { city, via: "city" };
  }
  for (const city of cities) {
    if (city.nearby.map(normalizePlace).includes(wanted)) return { city, via: "nearby" };
  }
  return undefined;
}
