import { getPack, getTemplate, type IndustryPack } from "@traiblazer/industry-packs";
import type { Lang, Localized } from "./site.js";

/**
 * Marketing copy for the industries that have landing pages. Each entry belongs to an industry pack
 * in `@traiblazer/industry-packs` (same slug): the pack supplies the trades it covers and the
 * questions its assistant suggests, this file supplies the words around them.
 *
 * To add an industry: add an entry here for a pack that businesses can already choose (rollout
 * phase 1). Describe only what the product does for that pack today (see the pack's template), and
 * keep "limits" honest: it tells readers what the assistant will not do.
 */
export interface IndustryCopy {
  /** Pack slug in `@traiblazer/industry-packs`; also the URL part. */
  slug: string;
  /** Industry name as a heading, e.g. "Trades & home services". */
  name: Localized;
  /** Who it is for, plural, fits "AI assistant for … in Thunder Bay". */
  audience: Localized;
  /** The trades or business types covered, in the same order as the pack's variants. */
  kinds: Record<Lang, string[]>;
  /** The problem, in the owner's words. */
  problem: Localized;
  /** What the page and assistant do for this industry. */
  does: Record<Lang, string[]>;
  /** What the assistant will not do. */
  limits: Localized;
}

const industryCopy: IndustryCopy[] = [
  {
    slug: "trades",
    name: { en: "Trades & home services", fr: "Métiers et services à domicile" },
    audience: {
      en: "plumbers, electricians and home service trades",
      fr: "plombiers, électriciens et services à domicile",
    },
    kinds: {
      en: [
        "Plumbing",
        "Heating and cooling (HVAC)",
        "Electrical",
        "Roofing",
        "Landscaping and snow removal",
        "Cleaning",
      ],
      fr: [
        "Plomberie",
        "Chauffage et climatisation (CVC)",
        "Électricité",
        "Toiture",
        "Aménagement paysager et déneigement",
        "Nettoyage",
      ],
    },
    problem: {
      en: "You are on a job, under a sink or on a roof, when the phone rings. A call you can't take often goes to the next company on the list.",
      fr: "Vous êtes sur un chantier, sous un évier ou sur un toit, quand le téléphone sonne. Un appel manqué va souvent à l'entreprise suivante sur la liste.",
    },
    does: {
      en: [
        "Answers questions about your services, hours and prices from the information you gave it.",
        "Checks whether you serve the customer's town before taking the request.",
        "Takes quote and repair requests with the details and photos you need, and sends them to you by email.",
        "Flags urgent problems such as an active leak or no heat in winter, and gives your emergency number right away.",
      ],
      fr: [
        "Répond aux questions sur vos services, vos heures et vos prix à partir des renseignements que vous lui avez donnés.",
        "Vérifie si vous desservez la localité du client avant de prendre la demande.",
        "Prend les demandes de soumission et de réparation avec les détails et les photos nécessaires, et vous les envoie par courriel.",
        "Signale les problèmes urgents, comme une fuite active ou une panne de chauffage en hiver, et donne aussitôt votre numéro d'urgence.",
      ],
    },
    limits: {
      en: "It never diagnoses a fault, promises a price or an arrival time, or gives repair steps for gas, electrical or structural work. For a smell of gas or a carbon monoxide alarm it tells the person to leave and call 911.",
      fr: "Il ne pose jamais de diagnostic, ne promet ni prix ni heure d'arrivée, et ne donne aucune consigne de réparation pour le gaz, l'électricité ou la structure. En cas d'odeur de gaz ou d'alarme de monoxyde de carbone, il dit à la personne de sortir et d'appeler le 911.",
    },
  },
  {
    slug: "auto-repair",
    name: { en: "Auto repair & tire shops", fr: "Ateliers mécaniques et centres de pneus" },
    audience: { en: "auto repair and tire shops", fr: "ateliers mécaniques et centres de pneus" },
    kinds: {
      en: ["General repair", "Tire centres", "Body and collision", "Auto glass", "Oil change", "Detailing"],
      fr: [
        "Mécanique générale",
        "Centres de pneus",
        "Carrosserie et collision",
        "Vitres d'auto",
        "Vidange d'huile",
        "Esthétique automobile",
      ],
    },
    problem: {
      en: "The same questions come in all day, and they pile up in the fall and spring tire rush: do you have a spot, how much is a changeover, when can I drop off the car?",
      fr: "Les mêmes questions reviennent toute la journée et s'accumulent durant la ruée des pneus d'automne et du printemps : avez-vous une place, combien coûte le changement, quand puis-je laisser l'auto?",
    },
    does: {
      en: [
        "Answers questions about services, hours, drop-off and pick-up.",
        "Quotes tire and service prices only from your own price list.",
        "Takes changeover and repair requests with the vehicle and tire size, and shares your booking link.",
        "Sends each request to you by email so the counter isn't tied to the phone.",
      ],
      fr: [
        "Répond aux questions sur les services, les heures, le dépôt et la récupération du véhicule.",
        "Donne les prix des pneus et des services uniquement à partir de votre propre liste de prix.",
        "Prend les demandes de changement de pneus et de réparation avec le véhicule et la dimension des pneus, et partage votre lien de réservation.",
        "Vous envoie chaque demande par courriel pour libérer le comptoir du téléphone.",
      ],
    },
    limits: {
      en: "It doesn't diagnose a problem from a description, say whether a car is safe to drive, or give a binding repair price: estimates follow an inspection.",
      fr: "Il ne pose pas de diagnostic à partir d'une description, ne dit pas si un véhicule est sécuritaire et ne donne pas de prix ferme : l'estimation suit l'inspection.",
    },
  },
  {
    slug: "restaurant",
    name: { en: "Restaurants & bars", fr: "Restaurants et bars" },
    audience: { en: "restaurants and bars", fr: "restaurants et bars" },
    kinds: {
      en: ["Casual dining", "Fine dining", "Pubs and bars", "Buffets", "Takeout"],
      fr: ["Restauration décontractée", "Gastronomie", "Pubs et bars", "Buffets", "Mets à emporter"],
    },
    problem: {
      en: "During service nobody can answer the phone, yet that is exactly when guests ask about hours, the menu and a table for tonight.",
      fr: "Pendant le service, personne ne peut répondre au téléphone, et c'est justement là que les clients demandent les heures, le menu et une table pour ce soir.",
    },
    does: {
      en: [
        "Answers questions about hours, the menu and prices, takeout and delivery, parking and accessibility.",
        "Explains how to reserve and shares your reservation link or phone number.",
        "Shows your menu, photos and notices (holiday hours, events) on one page that works on any phone.",
        "Answers in the guest's language, including French and English.",
      ],
      fr: [
        "Répond aux questions sur les heures, le menu et les prix, les mets à emporter et la livraison, le stationnement et l'accessibilité.",
        "Explique comment réserver et partage votre lien de réservation ou votre numéro de téléphone.",
        "Présente votre menu, vos photos et vos avis (heures des fêtes, événements) sur une page qui s'affiche bien sur tout téléphone.",
        "Répond dans la langue du client, dont le français et l'anglais.",
      ],
    },
    limits: {
      en: "It answers only from your menu and information. On allergens and dietary needs it says only what your menu says, and always tells guests to confirm with your staff before ordering.",
      fr: "Il répond uniquement à partir de votre menu et de vos renseignements. Sur les allergènes et les besoins alimentaires, il s'en tient à ce que dit votre menu et invite toujours les clients à confirmer auprès de votre personnel avant de commander.",
    },
  },
  {
    slug: "cafe-bakery",
    name: { en: "Cafés & bakeries", fr: "Cafés et boulangeries" },
    audience: { en: "cafés and bakeries", fr: "cafés et boulangeries" },
    kinds: {
      en: ["Cafés", "Bakeries and custom cakes", "Coffee roasters"],
      fr: ["Cafés", "Boulangeries et gâteaux sur mesure", "Torréfacteurs"],
    },
    problem: {
      en: "With a line at the counter, messages about custom cakes, pre-orders and today's hours wait until closing, and some customers don't wait.",
      fr: "Avec une file au comptoir, les messages sur les gâteaux sur mesure, les précommandes et les heures du jour attendent la fermeture, et certains clients n'attendent pas.",
    },
    does: {
      en: [
        "Answers questions about hours, the menu and what you bake.",
        "Takes the details of custom and celebration cake requests and catering orders, and sends them to you.",
        "Explains pre-orders and pickup the way you set them out.",
        "Shows your products, photos and notices on one page you can link from a QR code or your Google listing.",
      ],
      fr: [
        "Répond aux questions sur les heures, le menu et vos produits.",
        "Prend les détails des demandes de gâteaux sur mesure et de traiteur, et vous les envoie.",
        "Explique les précommandes et la cueillette telles que vous les avez définies.",
        "Présente vos produits, vos photos et vos avis sur une page à lier depuis un code QR ou votre fiche Google.",
      ],
    },
    limits: {
      en: "It answers only from your information; on allergens it tells customers to confirm with your staff. Lead times, deposits and prices are yours to set; it never makes them up.",
      fr: "Il répond uniquement à partir de vos renseignements; pour les allergènes, il invite les clients à confirmer auprès de votre personnel. Les délais, les dépôts et les prix sont les vôtres : il n'en invente jamais.",
    },
  },
  {
    slug: "retail",
    name: { en: "Retail stores", fr: "Commerces de détail" },
    audience: { en: "retail stores", fr: "commerces de détail" },
    kinds: {
      en: [
        "Clothing and outdoor",
        "Florists",
        "Gift and artisan shops",
        "Hardware",
        "Jewellery",
        "Books, hobby and collectibles",
        "International and specialty food and goods",
      ],
      fr: [
        "Vêtements et plein air",
        "Fleuristes",
        "Boutiques de cadeaux et d'artisanat",
        "Quincailleries",
        "Bijouteries",
        "Livres, loisirs et objets de collection",
        "Aliments et produits internationaux et spécialisés",
      ],
    },
    problem: {
      en: "Shoppers check on their phone before they make the trip: are you open, do you carry it, can I return it? If they can't find out, they shop somewhere else.",
      fr: "Les clients vérifient sur leur téléphone avant de se déplacer : êtes-vous ouverts, l'avez-vous en magasin, puis-je le retourner? Sans réponse, ils vont ailleurs.",
    },
    does: {
      en: [
        "Answers questions about hours, location, products and services.",
        "Explains returns, shipping and gift cards from your own policies.",
        "Takes product inquiries and passes them to you when the answer needs a person.",
        "Shows your products with photos and prices on one page, with a link to your online shop if you have one.",
      ],
      fr: [
        "Répond aux questions sur les heures, l'emplacement, les produits et les services.",
        "Explique les retours, la livraison et les cartes-cadeaux selon vos propres politiques.",
        "Prend les demandes sur les produits et vous les transmet quand la réponse exige une personne.",
        "Présente vos produits avec photos et prix sur une page, avec un lien vers votre boutique en ligne si vous en avez une.",
      ],
    },
    limits: {
      en: "It doesn't know your live stock. It says what you carry from the information you gave it and never promises that an item is on the shelf.",
      fr: "Il ne connaît pas votre inventaire en temps réel. Il indique ce que vous offrez d'après vos renseignements et ne promet jamais qu'un article est en magasin.",
    },
  },
  {
    slug: "personal-care",
    name: { en: "Salons, spas & barbers", fr: "Salons, spas et barbiers" },
    audience: { en: "salons, spas and barbers", fr: "salons, spas et barbiers" },
    kinds: {
      en: ["Hair salons", "Spas", "Barbers", "Tattoo and piercing studios"],
      fr: ["Salons de coiffure", "Spas", "Barbiers", "Studios de tatouage et de perçage"],
    },
    problem: {
      en: "Your hands are busy with a client when someone asks about prices, an opening this week or your cancellation policy.",
      fr: "Vous avez les mains prises avec un client quand quelqu'un demande vos prix, une disponibilité cette semaine ou votre politique d'annulation.",
    },
    does: {
      en: [
        "Answers questions about services and prices from your own list.",
        "Explains how to book and shares your booking link.",
        "Explains your cancellation policy and how to prepare for an appointment, as you wrote them.",
        "Shows your services, photos of your work and hours on one page.",
      ],
      fr: [
        "Répond aux questions sur les services et les prix à partir de votre propre liste.",
        "Explique comment prendre rendez-vous et partage votre lien de réservation.",
        "Explique votre politique d'annulation et la préparation à un rendez-vous, telles que vous les avez rédigées.",
        "Présente vos services, des photos de votre travail et vos heures sur une page.",
      ],
    },
    limits: {
      en: "It gives no medical or skin-care advice and doesn't promise a result. Prices and policies come only from what you entered.",
      fr: "Il ne donne aucun conseil médical ou de soins de la peau et ne promet aucun résultat. Les prix et les politiques viennent uniquement de ce que vous avez saisi.",
    },
  },
  {
    slug: "lodging",
    name: { en: "Motels, B&Bs & lodges", fr: "Motels, gîtes et pourvoiries" },
    audience: { en: "motels, B&Bs and lodges", fr: "motels, gîtes et pourvoiries" },
    kinds: {
      en: ["Motels", "Bed and breakfasts", "Lodges and outfitters", "Small hotels"],
      fr: ["Motels", "Gîtes touristiques", "Pourvoiries et auberges", "Petits hôtels"],
    },
    problem: {
      en: "Guests plan in the evening and from other time zones. Questions about rooms, pets and check-in arrive when the front desk is closed.",
      fr: "Les voyageurs planifient le soir et depuis d'autres fuseaux horaires. Les questions sur les chambres, les animaux et l'arrivée arrivent quand la réception est fermée.",
    },
    does: {
      en: [
        "Answers questions about rooms, rates, check-in and check-out, amenities, pets and parking.",
        "Explains how to book and shares your booking link or phone number.",
        "Passes on local tips you have written down, such as where to eat or launch a boat.",
        "Answers travellers in their own language.",
      ],
      fr: [
        "Répond aux questions sur les chambres, les tarifs, l'arrivée et le départ, les commodités, les animaux et le stationnement.",
        "Explique comment réserver et partage votre lien de réservation ou votre numéro de téléphone.",
        "Transmet les conseils locaux que vous avez notés, comme où manger ou mettre un bateau à l'eau.",
        "Répond aux voyageurs dans leur langue.",
      ],
    },
    limits: {
      en: "It doesn't see your reservation system, so it never confirms that a room is free or holds one. It sends the guest to your booking link or your phone.",
      fr: "Il ne voit pas votre système de réservation : il ne confirme jamais qu'une chambre est libre et n'en retient pas. Il dirige le client vers votre lien de réservation ou votre téléphone.",
    },
  },
  {
    slug: "attractions",
    name: { en: "Attractions, tours & recreation", fr: "Attraits, visites et loisirs" },
    audience: {
      en: "attractions, tours and recreation businesses",
      fr: "attraits, visites guidées et entreprises de loisirs",
    },
    kinds: {
      en: ["Tours", "Ski hills and trails", "Golf courses", "Activity venues"],
      fr: ["Visites guidées", "Centres de ski et sentiers", "Terrains de golf", "Centres d'activités"],
    },
    problem: {
      en: "Visitors decide on the day: are you open, how much is it, what should we bring? In high season there is nobody free to answer.",
      fr: "Les visiteurs décident le jour même : êtes-vous ouverts, combien ça coûte, que faut-il apporter? En haute saison, personne n'est libre pour répondre.",
    },
    does: {
      en: [
        "Answers questions about schedules, tickets and prices, what to bring and how to get there.",
        "Shows notices you post, such as a closure or a change in conditions, at the top of your page.",
        "Helps visitors plan a visit and shares your ticket or booking link.",
        "Answers visitors in their own language.",
      ],
      fr: [
        "Répond aux questions sur les horaires, les billets et les prix, quoi apporter et comment s'y rendre.",
        "Affiche vos avis, comme une fermeture ou un changement de conditions, en haut de votre page.",
        "Aide les visiteurs à planifier leur visite et partage votre lien de billetterie ou de réservation.",
        "Répond aux visiteurs dans leur langue.",
      ],
    },
    limits: {
      en: "It reports conditions and closures only as you posted them and gives no safety assessment of its own.",
      fr: "Il rapporte les conditions et les fermetures uniquement telles que vous les avez publiées et ne fait aucune évaluation de sécurité.",
    },
  },
];

export interface Industry extends IndustryCopy {
  pack: IndustryPack;
  /** Questions the pack's assistant suggests to visitors (from the pack's template). */
  sampleQuestions: Record<Lang, string[]>;
}

/** Industries with landing pages: only packs businesses can choose today (rollout phase 1). */
export const industries: Industry[] = industryCopy.flatMap((copy) => {
  const pack = getPack(copy.slug);
  if (pack?.phase !== 1) return [];
  return [{ ...copy, pack, sampleQuestions: getTemplate(copy.slug).quickReplies }];
});

export function getIndustry(slug: string): Industry | undefined {
  return industries.find((i) => i.slug === slug);
}
