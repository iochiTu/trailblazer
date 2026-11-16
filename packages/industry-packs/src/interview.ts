/**
 * The setup interview (PLAN §7.1, milestone 1.4): the questions a business answers when it signs up
 * (the onboarding chat) or later from its Knowledge tab. The owner's answers become a knowledge
 * source, which the assistant answers from and the setup assistant reads to propose the page, the
 * services and their prices.
 *
 * The questions live in the database (`onboarding_questions`) and staff edit them in the operator
 * console. `STANDARD_QUESTIONS` below is the standard set: the database is seeded from it, and staff
 * can put a standard question back to this wording.
 *
 * Writing rule: a question asks for facts only the business knows; a hint shows the kind of answer,
 * never a fact the business didn't give. Every question can be skipped.
 */

export type Localized = { en: string; fr: string };

/**
 * short: a line or two; long: one line per item (services and prices); choice: quick answers to
 * tap (the owner can still write their own).
 */
export const INTERVIEW_KINDS = ["short", "long", "choice"] as const;
export type InterviewKind = (typeof INTERVIEW_KINDS)[number];

export interface InterviewQuestion {
  /** Stable key: answers are stored under it. */
  key: string;
  question: Localized;
  /** An example of the kind of answer (may be empty). */
  hint: Localized;
  kind: InterviewKind;
  /** Quick answers, for "choice" questions. */
  options: Localized[];
}

/** A question of the set: which industries it is asked for and where it comes in the order. */
export interface QuestionSetEntry extends InterviewQuestion {
  /** Industry pack slugs it is asked for; empty: every industry. */
  packs: string[];
  /** Lower is asked first. */
  sortOrder: number;
  /** Turned off: kept, but not asked. */
  enabled: boolean;
}

export const INTERVIEW_LIMITS = {
  answerLength: 2000,
  questionLength: 300,
  hintLength: 300,
  options: 8,
  optionLength: 80,
  /** Questions in the whole set. */
  questions: 200,
} as const;

/** Keys are lowercase letters, digits and underscores (answers are stored under them). */
export const QUESTION_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

let order = 0;
const q = (
  key: string,
  packs: string[],
  question: Localized,
  hint: Localized,
  extra: { kind?: InterviewKind; options?: Localized[]; sortOrder?: number } = {},
): QuestionSetEntry => {
  order += 10;
  return {
    key,
    packs,
    question,
    hint,
    kind: extra.kind ?? "short",
    options: extra.options ?? [],
    sortOrder: extra.sortOrder ?? order,
    enabled: true,
  };
};

const ALL: string[] = [];
/** Industries whose customers come to the business (parking and access matter). */
const VISITED = [
  "auto-repair",
  "restaurant",
  "cafe-bakery",
  "retail",
  "personal-care",
  "lodging",
  "attractions",
  "generic",
];
const FOOD = ["restaurant", "cafe-bakery"];

/** The standard question set, in the order it is asked: common questions, then each industry's. */
export const STANDARD_QUESTIONS: QuestionSetEntry[] = [
  // ---- Every industry ----------------------------------------------------------------------
  q(
    "about",
    ALL,
    { en: "What does your business do?", fr: "Que fait votre entreprise?" },
    {
      en: "In a sentence or two, e.g. “Family-run plumbing company, in business since 2009.”",
      fr: "En une ou deux phrases, p. ex. « Entreprise familiale de plomberie, en activité depuis 2009. »",
    },
  ),
  q(
    "services",
    ALL,
    {
      en: "What services or products do you offer, and at what price?",
      fr: "Quels services ou produits offrez-vous, et à quel prix?",
    },
    {
      en: "One per line, e.g. “Drain cleaning – from $149”. Write “call for a quote” where there is no set price.",
      fr: "Un par ligne, p. ex. « Débouchage – à partir de 149 $ ». Écrivez « sur devis » quand il n'y a pas de prix fixe.",
    },
    { kind: "long" },
  ),
  q(
    "where",
    ALL,
    {
      en: "Where are you, or which towns and areas do you serve?",
      fr: "Où êtes-vous situé, ou quelles villes et quels secteurs desservez-vous?",
    },
    {
      en: "Your address, or the towns you travel to, e.g. “Guelph, Fergus and Elora”.",
      fr: "Votre adresse, ou les villes où vous vous déplacez, p. ex. « Gatineau, Chelsea et Cantley ».",
    },
  ),
  q(
    "hours",
    ALL,
    { en: "When are you open?", fr: "Quelles sont vos heures d'ouverture?" },
    {
      en: "e.g. “Monday to Friday 8 am to 5 pm, Saturday 9 am to noon, closed Sunday”.",
      fr: "p. ex. « Du lundi au vendredi de 8 h à 17 h, le samedi de 9 h à midi, fermé le dimanche ».",
    },
  ),
  q(
    "contact",
    ALL,
    {
      en: "How should customers reach you or book?",
      fr: "Comment les clients doivent-ils vous joindre ou réserver?",
    },
    {
      en: "Phone, email, a booking link, walk-ins…",
      fr: "Téléphone, courriel, lien de réservation, sans rendez-vous…",
    },
  ),
  q(
    "payment",
    ALL,
    { en: "Which payment methods do you accept?", fr: "Quels modes de paiement acceptez-vous?" },
    {
      en: "e.g. “Cash, debit, Visa, Mastercard, e-Transfer”.",
      fr: "p. ex. « Comptant, débit, Visa, Mastercard, virement Interac ».",
    },
  ),
  q(
    "visit",
    VISITED,
    {
      en: "Is there parking, and is your place accessible?",
      fr: "Y a-t-il du stationnement, et vos locaux sont-ils accessibles?",
    },
    {
      en: "e.g. “Free parking behind the building; step-free entrance”.",
      fr: "p. ex. « Stationnement gratuit derrière l'immeuble; entrée sans marche ».",
    },
  ),

  // ---- Trades & home services ----------------------------------------------------------------
  q(
    "emergency",
    ["trades"],
    {
      en: "Do you take emergency calls? When, and how should customers reach you for one?",
      fr: "Prenez-vous les appels d'urgence? Quand, et comment vous joindre dans ce cas?",
    },
    {
      en: "e.g. “24/7 for leaks and no heat: call 519-555-0100”, or “No emergency service”.",
      fr: "p. ex. « 24 h sur 24 pour les fuites et les pannes de chauffage : 819-555-0100 », ou « Pas de service d'urgence ».",
    },
  ),
  q(
    "quotes",
    ["trades"],
    {
      en: "How do quotes work? Is there a charge for an estimate or a service call?",
      fr: "Comment fonctionnent les devis? Facturez-vous l'estimation ou le déplacement?",
    },
    {
      en: "e.g. “Free estimates; $95 service call, waived if you go ahead with the work”.",
      fr: "p. ex. « Estimation gratuite; déplacement 95 $, offert si les travaux sont faits ».",
    },
  ),
  q(
    "credentials",
    ["trades"],
    {
      en: "Are you licensed and insured? Do you guarantee your work?",
      fr: "Êtes-vous titulaire d'une licence et assuré? Garantissez-vous vos travaux?",
    },
    {
      en: "Licence numbers, certifications, insurance and warranty, as you'd want customers to see them.",
      fr: "Numéros de licence, certifications, assurance et garantie, tels que vous voulez que les clients les voient.",
    },
  ),

  // ---- Auto repair & tire shop ---------------------------------------------------------------
  q(
    "vehicles",
    ["auto-repair"],
    {
      en: "Which vehicles do you work on? Any you don't?",
      fr: "Sur quels véhicules travaillez-vous? Y en a-t-il que vous ne prenez pas?",
    },
    {
      en: "e.g. “All makes, cars and light trucks; no diesel or motorcycles”.",
      fr: "p. ex. « Toutes marques, autos et camionnettes; pas de diesel ni de motos ».",
    },
  ),
  q(
    "tires",
    ["auto-repair"],
    {
      en: "Do you sell or store tires? How do seasonal changeovers work?",
      fr: "Vendez-vous ou entreposez-vous des pneus? Comment fonctionne le changement saisonnier?",
    },
    {
      en: "e.g. “Changeover on rims $49.99, by appointment; storage $80 a season”.",
      fr: "p. ex. « Changement sur jantes 49,99 $, sur rendez-vous; entreposage 80 $ par saison ».",
    },
  ),
  q(
    "waiting",
    ["auto-repair"],
    {
      en: "Can customers wait, get a ride or a loaner car while you work?",
      fr: "Les clients peuvent-ils attendre sur place, être raccompagnés ou avoir une voiture de courtoisie?",
    },
    {
      en: "e.g. “Waiting room with Wi-Fi; shuttle within 5 km”.",
      fr: "p. ex. « Salle d'attente avec Wi-Fi; navette dans un rayon de 5 km ».",
    },
  ),
  q(
    "warranty",
    ["auto-repair"],
    {
      en: "Do you offer a warranty on parts and labour?",
      fr: "Offrez-vous une garantie sur les pièces et la main-d'œuvre?",
    },
    {
      en: "e.g. “12 months or 20,000 km on parts and labour”.",
      fr: "p. ex. « 12 mois ou 20 000 km sur les pièces et la main-d'œuvre ».",
    },
  ),

  // ---- Restaurants, cafés and bakeries -------------------------------------------------------
  q(
    "dietary",
    FOOD,
    {
      en: "Which dietary needs can you accommodate?",
      fr: "Quels besoins alimentaires pouvez-vous accommoder?",
    },
    {
      en: "e.g. “Vegetarian and vegan options; gluten-free bread on request; we can't guarantee nut-free”.",
      fr: "p. ex. « Options végétariennes et véganes; pain sans gluten sur demande; sans noix non garanti ».",
    },
  ),
  q(
    "ordering",
    FOOD,
    {
      en: "Do you take reservations, takeout, delivery or catering orders? How?",
      fr: "Prenez-vous les réservations, les commandes à emporter, la livraison ou le traiteur? Comment?",
    },
    {
      en: "e.g. “Reservations by phone for 6 or more; takeout and delivery through our website”.",
      fr: "p. ex. « Réservations par téléphone à partir de 6 personnes; à emporter et livraison sur notre site ».",
    },
  ),
  q(
    "custom_orders",
    ["cafe-bakery"],
    {
      en: "Do you take custom orders, such as cakes for events? How far ahead?",
      fr: "Prenez-vous des commandes spéciales, comme des gâteaux pour un événement? Combien de temps à l'avance?",
    },
    {
      en: "e.g. “Custom cakes from $45, ordered at least 3 days ahead”.",
      fr: "p. ex. « Gâteaux personnalisés à partir de 45 $, commandés au moins 3 jours à l'avance ».",
    },
  ),
  q(
    "groups",
    ["restaurant", "attractions"],
    {
      en: "Do you host groups, private events or school visits?",
      fr: "Accueillez-vous des groupes, des événements privés ou des sorties scolaires?",
    },
    {
      en: "e.g. “Private room for up to 30; group rates from 15 people, booked a week ahead”.",
      fr: "p. ex. « Salle privée jusqu'à 30 personnes; tarif de groupe dès 15 personnes, réservé une semaine à l'avance ».",
    },
  ),

  // ---- Retail --------------------------------------------------------------------------------
  q(
    "brands",
    ["retail"],
    {
      en: "Which brands or kinds of products do you carry?",
      fr: "Quelles marques ou quels types de produits offrez-vous?",
    },
    {
      en: "e.g. “Outdoor clothing and footwear: Arc'teryx, Merrell, local wool socks”.",
      fr: "p. ex. « Vêtements et chaussures de plein air : Arc'teryx, Merrell, bas de laine d'ici ».",
    },
  ),
  q(
    "pickup",
    ["retail"],
    {
      en: "Can customers order online, reserve an item, or get it delivered?",
      fr: "Les clients peuvent-ils commander en ligne, réserver un article ou se faire livrer?",
    },
    { en: "", fr: "" },
    {
      kind: "choice",
      options: [
        { en: "In store only", fr: "En magasin seulement" },
        { en: "Online shop with in-store pickup", fr: "Boutique en ligne avec cueillette en magasin" },
        { en: "Online shop with delivery", fr: "Boutique en ligne avec livraison" },
        { en: "We hold items by phone", fr: "Nous mettons des articles de côté par téléphone" },
      ],
    },
  ),
  q(
    "returns",
    ["retail"],
    {
      en: "What is your return and exchange policy?",
      fr: "Quelle est votre politique de retour et d'échange?",
    },
    {
      en: "e.g. “Exchange or store credit within 30 days with receipt; final sale items excluded”.",
      fr: "p. ex. « Échange ou crédit en magasin dans les 30 jours avec reçu; articles en solde finale exclus ».",
    },
  ),

  // ---- Salon, spa & barber -------------------------------------------------------------------
  q(
    "appointments",
    ["personal-care"],
    {
      en: "Do you take walk-ins, or by appointment only?",
      fr: "Acceptez-vous les clients sans rendez-vous, ou seulement sur rendez-vous?",
    },
    { en: "", fr: "" },
    {
      kind: "choice",
      options: [
        { en: "By appointment only", fr: "Sur rendez-vous seulement" },
        { en: "Walk-ins welcome", fr: "Sans rendez-vous bienvenus" },
        { en: "Both, appointments first", fr: "Les deux, priorité aux rendez-vous" },
      ],
    },
  ),
  q(
    "first_visit",
    ["personal-care"],
    {
      en: "Is there anything new clients should know before their first visit?",
      fr: "Les nouveaux clients doivent-ils savoir quelque chose avant leur première visite?",
    },
    {
      en: "e.g. “Arrive 10 minutes early; a patch test is needed 48 hours before any colour”.",
      fr: "p. ex. « Arrivez 10 minutes à l'avance; un test cutané est requis 48 heures avant une coloration ».",
    },
  ),
  q(
    "cancellation",
    ["personal-care", "lodging"],
    { en: "What is your cancellation policy?", fr: "Quelle est votre politique d'annulation?" },
    {
      en: "e.g. “Free cancellation up to 24 hours before; 50% charged after that”.",
      fr: "p. ex. « Annulation gratuite jusqu'à 24 heures avant; 50 % facturé ensuite ».",
    },
  ),

  // ---- Lodging -------------------------------------------------------------------------------
  q(
    "checkin",
    ["lodging"],
    {
      en: "What are your check-in and check-out times?",
      fr: "Quelles sont vos heures d'arrivée et de départ?",
    },
    {
      en: "e.g. “Check-in from 4 pm, check-out by 11 am; late arrivals use the key box”.",
      fr: "p. ex. « Arrivée dès 16 h, départ avant 11 h; boîte à clés pour les arrivées tardives ».",
    },
  ),
  q(
    "amenities",
    ["lodging"],
    {
      en: "What is included in a stay?",
      fr: "Qu'est-ce qui est inclus dans un séjour?",
    },
    {
      en: "e.g. “Breakfast, Wi-Fi, parking and the pool; kayaks for $20 a day”.",
      fr: "p. ex. « Déjeuner, Wi-Fi, stationnement et piscine; kayaks à 20 $ par jour ».",
    },
  ),
  q(
    "pets",
    ["lodging"],
    { en: "Are pets welcome?", fr: "Les animaux sont-ils acceptés?" },
    { en: "", fr: "" },
    {
      kind: "choice",
      options: [
        { en: "Pets welcome", fr: "Animaux bienvenus" },
        { en: "In some rooms only", fr: "Dans certaines chambres seulement" },
        { en: "No pets", fr: "Pas d'animaux" },
      ],
    },
  ),

  // ---- Attractions ---------------------------------------------------------------------------
  q(
    "tickets",
    ["attractions"],
    {
      en: "How do tickets or admission work? Do visitors need to book ahead?",
      fr: "Comment fonctionnent les billets ou l'admission? Faut-il réserver à l'avance?",
    },
    {
      en: "e.g. “Adults $18, children under 5 free; online booking recommended on weekends”.",
      fr: "p. ex. « Adultes 18 $, gratuit pour les moins de 5 ans; réservation en ligne conseillée la fin de semaine ».",
    },
  ),
  q(
    "season",
    ["attractions"],
    { en: "Are you open all year, or for a season?", fr: "Êtes-vous ouvert toute l'année, ou en saison?" },
    { en: "", fr: "" },
    {
      kind: "choice",
      options: [
        { en: "Open all year", fr: "Ouvert toute l'année" },
        { en: "Summer season only", fr: "En été seulement" },
        { en: "Winter season only", fr: "En hiver seulement" },
      ],
    },
  ),

  // ---- Every industry, last -----------------------------------------------------------------
  q(
    "faq",
    ALL,
    {
      en: "What do customers ask you most often, and what do you tell them?",
      fr: "Quelles questions vos clients posent-ils le plus souvent, et que leur répondez-vous?",
    },
    {
      en: "One per line, e.g. “Do you work weekends? – Saturdays only, by appointment”.",
      fr: "Une par ligne, p. ex. « Travaillez-vous la fin de semaine? – Le samedi seulement, sur rendez-vous ».",
    },
    { kind: "long", sortOrder: 900 },
  ),
];

/** The questions of a set asked for an industry, in order (turned-off questions left out). */
export function selectInterview(set: QuestionSetEntry[], slug: string): InterviewQuestion[] {
  return set
    .filter((entry) => entry.enabled && (entry.packs.length === 0 || entry.packs.includes(slug)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
    .map(({ key, question, hint, kind, options }) => ({ key, question, hint, kind, options }));
}

/** The standard interview for an industry (the database holds the one staff edit). */
export function getInterview(slug: string): InterviewQuestion[] {
  return selectInterview(STANDARD_QUESTIONS, slug);
}

export function getStandardQuestion(key: string): QuestionSetEntry | undefined {
  return STANDARD_QUESTIONS.find((entry) => entry.key === key);
}
