/**
 * Interview mode of the setup assistant (PLAN §7.1, milestone 1.4): a short list of questions for a
 * business without a website. The owner's answers become a knowledge source, which the assistant
 * answers from and the setup assistant reads to propose the page, the services and their prices.
 *
 * Writing rule: a question asks for facts only the business knows; a hint shows the kind of answer,
 * never a fact the business didn't give. Every question can be skipped.
 */

type Localized = { en: string; fr: string };

export interface InterviewQuestion {
  /** Stable key: answers are stored under it. */
  key: string;
  question: Localized;
  /** An example of the kind of answer. */
  hint: Localized;
  /** A longer answer: one line per item (services and prices). */
  long?: boolean;
}

export const INTERVIEW_LIMITS = { answerLength: 2000 } as const;

const q = (key: string, question: Localized, hint: Localized, long = false): InterviewQuestion => ({
  key,
  question,
  hint,
  ...(long ? { long } : {}),
});

const about = q(
  "about",
  { en: "What does your business do?", fr: "Que fait votre entreprise?" },
  {
    en: "In a sentence or two, e.g. “Family-run plumbing company, in business since 2009.”",
    fr: "En une ou deux phrases, p. ex. « Entreprise familiale de plomberie, en activité depuis 2009. »",
  },
);
const services = q(
  "services",
  {
    en: "What services or products do you offer, and at what price?",
    fr: "Quels services ou produits offrez-vous, et à quel prix?",
  },
  {
    en: "One per line, e.g. “Drain cleaning – from $149”. Write “call for a quote” where there is no set price.",
    fr: "Un par ligne, p. ex. « Débouchage – à partir de 149 $ ». Écrivez « sur devis » quand il n'y a pas de prix fixe.",
  },
  true,
);
const where = q(
  "where",
  {
    en: "Where are you, or which towns and areas do you serve?",
    fr: "Où êtes-vous situé, ou quelles villes et quels secteurs desservez-vous?",
  },
  {
    en: "Your address, or the towns you travel to, e.g. “Guelph, Fergus and Elora”.",
    fr: "Votre adresse, ou les villes où vous vous déplacez, p. ex. « Gatineau, Chelsea et Cantley ».",
  },
);
const hours = q(
  "hours",
  { en: "When are you open?", fr: "Quelles sont vos heures d'ouverture?" },
  {
    en: "e.g. “Monday to Friday 8 am to 5 pm, Saturday 9 am to noon, closed Sunday”.",
    fr: "p. ex. « Du lundi au vendredi de 8 h à 17 h, le samedi de 9 h à midi, fermé le dimanche ».",
  },
);
const contact = q(
  "contact",
  {
    en: "How should customers reach you or book?",
    fr: "Comment les clients doivent-ils vous joindre ou réserver?",
  },
  {
    en: "Phone, email, a booking link, walk-ins…",
    fr: "Téléphone, courriel, lien de réservation, sans rendez-vous…",
  },
);
const payment = q(
  "payment",
  { en: "Which payment methods do you accept?", fr: "Quels modes de paiement acceptez-vous?" },
  {
    en: "e.g. “Cash, debit, Visa, Mastercard, e-Transfer”.",
    fr: "p. ex. « Comptant, débit, Visa, Mastercard, virement Interac ».",
  },
);
const visit = q(
  "visit",
  {
    en: "Is there parking, and is your place accessible?",
    fr: "Y a-t-il du stationnement, et vos locaux sont-ils accessibles?",
  },
  {
    en: "e.g. “Free parking behind the building; step-free entrance”.",
    fr: "p. ex. « Stationnement gratuit derrière l'immeuble; entrée sans marche ».",
  },
);

/** Extra questions per industry, asked after the common ones. */
const byPack: Record<string, InterviewQuestion[]> = {
  trades: [
    q(
      "emergency",
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
      {
        en: "Are you licensed and insured? Do you guarantee your work?",
        fr: "Êtes-vous titulaire d'une licence et assuré? Garantissez-vous vos travaux?",
      },
      {
        en: "Licence numbers, certifications, insurance and warranty, as you'd want customers to see them.",
        fr: "Numéros de licence, certifications, assurance et garantie, tels que vous voulez que les clients les voient.",
      },
    ),
  ],
  "auto-repair": [
    q(
      "vehicles",
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
      {
        en: "Do you offer a warranty on parts and labour?",
        fr: "Offrez-vous une garantie sur les pièces et la main-d'œuvre?",
      },
      {
        en: "e.g. “12 months or 20,000 km on parts and labour”.",
        fr: "p. ex. « 12 mois ou 20 000 km sur les pièces et la main-d'œuvre ».",
      },
    ),
  ],
};

const food = [
  q(
    "dietary",
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
    {
      en: "Do you take reservations, takeout, delivery or catering orders? How?",
      fr: "Prenez-vous les réservations, les commandes à emporter, la livraison ou le traiteur? Comment?",
    },
    {
      en: "e.g. “Reservations by phone for 6 or more; takeout and delivery through our website”.",
      fr: "p. ex. « Réservations par téléphone à partir de 6 personnes; à emporter et livraison sur notre site ».",
    },
  ),
];
byPack.restaurant = food;
byPack["cafe-bakery"] = food;

/** Industries whose customers come to the business (parking and access matter). */
const VISITED = new Set([
  "auto-repair",
  "restaurant",
  "cafe-bakery",
  "retail",
  "personal-care",
  "lodging",
  "attractions",
  "generic",
]);

/** The interview for an industry: the common questions, then the industry's own. */
export function getInterview(slug: string): InterviewQuestion[] {
  return [
    about,
    services,
    where,
    hours,
    contact,
    payment,
    ...(VISITED.has(slug) ? [visit] : []),
    ...(byPack[slug] ?? []),
  ];
}
