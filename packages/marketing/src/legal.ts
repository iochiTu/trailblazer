import type { Lang } from "./site.js";

/**
 * Legal pages as data: the Cookies Policy and the AI usage disclaimer, in English and French. The
 * Next.js routes only lay this out. Keep the cookie list in step with what the apps actually store
 * (search for `tb_` and `tb:` in apps/), and bump LEGAL_UPDATED when the wording changes.
 */

export const LEGAL_UPDATED = "2026-11-16";

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
}

export interface StoredItem {
  name: string;
  /** "cookie", "local storage" or "session storage", in the page's language. */
  type: string;
  purpose: string;
  duration: string;
}

export interface LegalDoc {
  title: string;
  description: string;
  /** Short line under the title. */
  lead: string;
  sections: LegalSection[];
  /** Only on the Cookies Policy: what the site stores in the browser. */
  stored?: { heading: string; columns: [string, string, string, string]; rows: StoredItem[] };
}

export const LEGAL_UI: Record<Lang, { updated: string; cookies: string; ai: string; settings: string }> = {
  en: { updated: "Last updated", cookies: "Cookies", ai: "AI use", settings: "Cookie settings" },
  fr: {
    updated: "Dernière mise à jour",
    cookies: "Témoins",
    ai: "Utilisation de l'IA",
    settings: "Paramètres des témoins",
  },
};

export const formatLegalDate = (lang: Lang) =>
  new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${LEGAL_UPDATED}T00:00:00Z`),
  );

// ---- Cookies Policy ---------------------------------------------------------------------------

export const COOKIES_POLICY: Record<Lang, LegalDoc> = {
  en: {
    title: "Cookies Policy",
    description:
      "Which cookies and browser storage Traiblazer uses, why, and how to control them. We use only what the service needs to work: no advertising or tracking cookies.",
    lead: "Traiblazer uses only the cookies and browser storage it needs to work. We don't use advertising cookies, and we don't track you across other websites.",
    sections: [
      {
        heading: "What cookies and browser storage are",
        paragraphs: [
          "A cookie is a small text file a website saves in your browser. Local storage and session storage are similar: they let a page remember something on your device. This policy covers all three.",
        ],
      },
      {
        heading: "What we use them for",
        items: [
          "Keeping you signed in to your account, securely.",
          "Remembering the language you chose.",
          "Letting the chat assistant on a business's page or website keep your conversation going if you reload the page, and in the language you picked.",
          "Remembering small preferences in the dashboard, such as which business you last opened, an unfinished setup interview, and whether this device receives notifications.",
          "Counting a page view once per visit, without identifying you, so a business can see how many people opened its page.",
        ],
      },
      {
        heading: "What we don't do",
        items: [
          "No advertising or marketing cookies.",
          "No third-party analytics or tracking scripts.",
          "No selling or sharing of cookie data with advertisers.",
        ],
      },
      {
        heading: "Consent",
        paragraphs: [
          'When you first visit, a notice lets you accept or reject optional cookies. Everything listed below is strictly necessary for the service or remembers a choice you made, so it works whichever you pick. Today we use no optional cookies; if we add any, such as analytics, they will only run if you accepted. You can change your choice at any time with "Cookie settings" at the bottom of every page. We ask again about every six months.',
        ],
      },
      {
        heading: "Chat assistants on business websites",
        paragraphs: [
          "When a business adds the Traiblazer assistant to its own website, the assistant stores the items below on your device under Traiblazer's address. The business's own website may use its own cookies; those are covered by that business's policies, not this one.",
        ],
      },
      {
        heading: "How to control them",
        paragraphs: [
          "You can delete or block cookies and site data in your browser settings at any time. If you block them, you can still read public pages, but you won't be able to stay signed in, and the chat assistant will forget your conversation when you leave the page.",
        ],
      },
      {
        heading: "Contact",
        paragraphs: [
          "Questions about this policy? Contact us using the details at the bottom of this page. We may update this policy; the date above shows when it last changed.",
        ],
      },
    ],
    stored: {
      heading: "What we store",
      columns: ["Name", "Type", "Purpose", "How long"],
      rows: [
        {
          name: "tb_session",
          type: "Cookie (HTTP-only, secure)",
          purpose: "Keeps you signed in.",
          duration: "Until you sign out or the session expires",
        },
        {
          name: "tb_lang",
          type: "Cookie",
          purpose: "Remembers the language of the dashboard.",
          duration: "1 year",
        },
        {
          name: "tb_consent",
          type: "Cookie",
          purpose: "Remembers whether you accepted or rejected optional cookies.",
          duration: "6 months",
        },
        {
          name: "tb:…:visitor",
          type: "Local storage",
          purpose:
            "A random ID so the chat assistant can recognise a returning conversation. It doesn't contain your name or contact details.",
          duration: "Until you clear site data",
        },
        {
          name: "tb:…:conversation",
          type: "Local storage",
          purpose: "Reopens your current chat conversation.",
          duration: "Until you clear site data or start a new conversation",
        },
        {
          name: "tb:…:lang",
          type: "Local storage",
          purpose: "Remembers the language you chose in the chat assistant.",
          duration: "Until you clear site data",
        },
        {
          name: "tb:viewed:…",
          type: "Session storage",
          purpose: "Counts a business page view once per visit.",
          duration: "Until you close the tab",
        },
        {
          name: "tb_last_tenant",
          type: "Local storage",
          purpose: "Reopens the business you last worked on in the dashboard.",
          duration: "Until you clear site data",
        },
        {
          name: "tb.welcome.…",
          type: "Local storage",
          purpose: "Saves an unfinished setup interview so you don't lose it.",
          duration: "Until the interview is finished or you clear site data",
        },
        {
          name: "tb_push_device",
          type: "Local storage",
          purpose: "Remembers that this device receives notifications.",
          duration: "Until you turn notifications off or clear site data",
        },
      ],
    },
  },
  fr: {
    title: "Politique relative aux témoins",
    description:
      "Les témoins (cookies) et le stockage du navigateur qu'utilise Traiblazer, pourquoi, et comment les gérer. Seulement ce qui est nécessaire au service : aucun témoin publicitaire ni de suivi.",
    lead: "Traiblazer n'utilise que les témoins (cookies) et le stockage du navigateur nécessaires à son fonctionnement. Nous n'utilisons aucun témoin publicitaire et ne vous suivons pas sur d'autres sites.",
    sections: [
      {
        heading: "Ce que sont les témoins et le stockage du navigateur",
        paragraphs: [
          "Un témoin est un petit fichier texte qu'un site Web enregistre dans votre navigateur. Le stockage local et le stockage de session sont semblables : ils permettent à une page de mémoriser quelque chose sur votre appareil. Cette politique couvre les trois.",
        ],
      },
      {
        heading: "À quoi ils servent",
        items: [
          "Vous garder connecté à votre compte, de façon sécuritaire.",
          "Mémoriser la langue que vous avez choisie.",
          "Permettre à l'assistant de clavardage d'une page ou d'un site d'entreprise de poursuivre votre conversation si vous rechargez la page, dans la langue choisie.",
          "Mémoriser de petites préférences dans le tableau de bord, comme la dernière entreprise ouverte, une entrevue de configuration inachevée et la réception des notifications sur cet appareil.",
          "Compter une seule fois la consultation d'une page par visite, sans vous identifier, pour qu'une entreprise sache combien de personnes ont ouvert sa page.",
        ],
      },
      {
        heading: "Ce que nous ne faisons pas",
        items: [
          "Aucun témoin publicitaire ou de marketing.",
          "Aucun outil d'analyse ou de suivi de tiers.",
          "Aucune vente ni communication des données des témoins à des annonceurs.",
        ],
      },
      {
        heading: "Consentement",
        paragraphs: [
          "Lors de votre première visite, un avis vous permet d'accepter ou de refuser les témoins facultatifs. Tout ce qui est énuméré ci-dessous est strictement nécessaire au service ou mémorise un choix que vous avez fait; ces éléments fonctionnent donc quel que soit votre choix. Nous n'utilisons aujourd'hui aucun témoin facultatif; si nous en ajoutons, comme des outils d'analyse, ils ne seront actifs que si vous les avez acceptés. Vous pouvez modifier votre choix en tout temps avec « Paramètres des témoins » au bas de chaque page. Nous vous le redemandons environ tous les six mois.",
        ],
      },
      {
        heading: "Assistants de clavardage sur les sites d'entreprises",
        paragraphs: [
          "Lorsqu'une entreprise ajoute l'assistant Traiblazer à son propre site Web, l'assistant enregistre les éléments ci-dessous sur votre appareil, sous l'adresse de Traiblazer. Le site de l'entreprise peut utiliser ses propres témoins; ceux-ci relèvent des politiques de cette entreprise, et non de la présente.",
        ],
      },
      {
        heading: "Comment les gérer",
        paragraphs: [
          "Vous pouvez supprimer ou bloquer les témoins et les données de site dans les paramètres de votre navigateur en tout temps. Si vous les bloquez, vous pourrez toujours lire les pages publiques, mais vous ne pourrez pas rester connecté, et l'assistant oubliera votre conversation lorsque vous quitterez la page.",
        ],
      },
      {
        heading: "Nous joindre",
        paragraphs: [
          "Des questions sur cette politique? Communiquez avec nous à l'aide des coordonnées au bas de la page. Nous pouvons modifier cette politique; la date ci-dessus indique sa dernière mise à jour.",
        ],
      },
    ],
    stored: {
      heading: "Ce que nous enregistrons",
      columns: ["Nom", "Type", "Utilité", "Durée"],
      rows: [
        {
          name: "tb_session",
          type: "Témoin (HTTP seulement, sécurisé)",
          purpose: "Vous garde connecté.",
          duration: "Jusqu'à la déconnexion ou l'expiration de la session",
        },
        {
          name: "tb_lang",
          type: "Témoin",
          purpose: "Mémorise la langue du tableau de bord.",
          duration: "1 an",
        },
        {
          name: "tb_consent",
          type: "Témoin",
          purpose: "Mémorise si vous avez accepté ou refusé les témoins facultatifs.",
          duration: "6 mois",
        },
        {
          name: "tb:…:visitor",
          type: "Stockage local",
          purpose:
            "Un identifiant aléatoire qui permet à l'assistant de reconnaître une conversation. Il ne contient ni votre nom ni vos coordonnées.",
          duration: "Jusqu'à l'effacement des données du site",
        },
        {
          name: "tb:…:conversation",
          type: "Stockage local",
          purpose: "Rouvre votre conversation en cours.",
          duration: "Jusqu'à l'effacement des données du site ou une nouvelle conversation",
        },
        {
          name: "tb:…:lang",
          type: "Stockage local",
          purpose: "Mémorise la langue choisie dans l'assistant.",
          duration: "Jusqu'à l'effacement des données du site",
        },
        {
          name: "tb:viewed:…",
          type: "Stockage de session",
          purpose: "Compte une seule fois la consultation d'une page d'entreprise par visite.",
          duration: "Jusqu'à la fermeture de l'onglet",
        },
        {
          name: "tb_last_tenant",
          type: "Stockage local",
          purpose: "Rouvre la dernière entreprise consultée dans le tableau de bord.",
          duration: "Jusqu'à l'effacement des données du site",
        },
        {
          name: "tb.welcome.…",
          type: "Stockage local",
          purpose: "Conserve une entrevue de configuration inachevée pour ne pas la perdre.",
          duration: "Jusqu'à la fin de l'entrevue ou l'effacement des données du site",
        },
        {
          name: "tb_push_device",
          type: "Stockage local",
          purpose: "Mémorise que cet appareil reçoit les notifications.",
          duration: "Jusqu'à la désactivation des notifications ou l'effacement des données du site",
        },
      ],
    },
  },
};

// ---- AI usage disclaimer ----------------------------------------------------------------------

export const AI_DISCLAIMER: Record<Lang, LegalDoc> = {
  en: {
    title: "AI Usage Disclaimer",
    description:
      "How Traiblazer uses artificial intelligence, what its AI assistants can and can't do, and what businesses and their customers should know before relying on an answer.",
    lead: "Traiblazer's assistants use artificial intelligence. They are helpful, but they can make mistakes. Please read this before relying on what an assistant tells you.",
    sections: [
      {
        heading: "You are talking to an AI",
        paragraphs: [
          "The chat assistants on business pages and websites, the assistant that answers phone calls for a business, and the assistant that helps owners set up their account are AI systems, not people. When a business replies to you itself, the reply comes from that business, by email, phone or text.",
        ],
      },
      {
        heading: "Where the answers come from",
        paragraphs: [
          "Each assistant answers from the information its business provided, such as services, prices, hours, documents and its website. The text is generated by large language models run by third-party AI providers. The assistant is instructed not to invent prices, stock or availability, and to say when it doesn't know.",
        ],
      },
      {
        heading: "Answers can be wrong",
        items: [
          "AI can misunderstand a question, leave out details or state something incorrect with confidence.",
          "A business's information can be out of date or incomplete.",
          "Prices, availability, hours and bookings are only confirmed when the business confirms them.",
          "Always check anything important directly with the business before you act on it.",
        ],
      },
      {
        heading: "Not professional advice",
        paragraphs: [
          "Answers are general information only. They are not medical, legal, financial, tax, safety or other professional advice, and they don't replace a qualified person who knows your situation. In an emergency, call 911 or your local emergency number.",
        ],
      },
      {
        heading: "Your messages",
        items: [
          "Messages you send an assistant, including images and call audio or transcripts, are shared with the business so it can help you, and are processed by our AI providers to generate replies.",
          "Please don't share sensitive personal information, such as health details, payment card numbers, passwords or government ID numbers.",
          "Businesses can review conversations to improve their information and follow up with you.",
        ],
      },
      {
        heading: "For businesses using Traiblazer",
        items: [
          "You are responsible for the information you give your assistant and for keeping it accurate and up to date.",
          "Review your assistant's answers, especially in the Insights and Inbox views, and correct your information when you see a gap or mistake.",
          "Content the assistant drafts for you, such as replies, posts, page text or follow-ups, is a suggestion. Read it before you send or publish it.",
          "Let your customers know they are talking to an AI where the law in your area requires it.",
        ],
      },
      {
        heading: "Limitation",
        paragraphs: [
          "To the extent permitted by law, Traiblazer is not responsible for decisions made or losses suffered from relying on an AI-generated answer without confirming it with the business. This disclaimer adds to, and does not replace, the terms that apply to your use of the service.",
        ],
      },
      {
        heading: "Contact",
        paragraphs: [
          "Questions or concerns about an answer from a business's assistant? Contact that business directly. Questions about how Traiblazer uses AI? Contact us using the details at the bottom of this page.",
        ],
      },
    ],
  },
  fr: {
    title: "Avis sur l'utilisation de l'IA",
    description:
      "Comment Traiblazer utilise l'intelligence artificielle, ce que ses assistants IA peuvent et ne peuvent pas faire, et ce que les entreprises et leurs clients doivent savoir avant de se fier à une réponse.",
    lead: "Les assistants de Traiblazer utilisent l'intelligence artificielle. Ils sont utiles, mais peuvent se tromper. Veuillez lire ce qui suit avant de vous fier à ce qu'un assistant vous dit.",
    sections: [
      {
        heading: "Vous parlez à une IA",
        paragraphs: [
          "Les assistants de clavardage des pages et sites d'entreprises, l'assistant qui répond aux appels d'une entreprise et l'assistant qui aide les propriétaires à configurer leur compte sont des systèmes d'IA, et non des personnes. Lorsqu'une entreprise vous répond elle-même, la réponse vient de cette entreprise, par courriel, téléphone ou texto.",
        ],
      },
      {
        heading: "D'où viennent les réponses",
        paragraphs: [
          "Chaque assistant répond à partir des renseignements fournis par son entreprise : services, prix, heures, documents et site Web. Le texte est généré par de grands modèles de langage exploités par des fournisseurs d'IA tiers. L'assistant a pour consigne de ne pas inventer de prix, de stock ni de disponibilité, et de dire quand il ne sait pas.",
        ],
      },
      {
        heading: "Les réponses peuvent être erronées",
        items: [
          "L'IA peut mal comprendre une question, omettre des détails ou affirmer avec assurance quelque chose d'inexact.",
          "Les renseignements d'une entreprise peuvent être périmés ou incomplets.",
          "Les prix, la disponibilité, les heures et les réservations ne sont confirmés que lorsque l'entreprise les confirme.",
          "Vérifiez toujours directement auprès de l'entreprise tout ce qui est important avant d'agir.",
        ],
      },
      {
        heading: "Pas un avis professionnel",
        paragraphs: [
          "Les réponses sont des renseignements généraux seulement. Elles ne constituent pas un avis médical, juridique, financier, fiscal, de sécurité ou autre avis professionnel, et ne remplacent pas une personne qualifiée qui connaît votre situation. En cas d'urgence, composez le 911 ou le numéro d'urgence local.",
        ],
      },
      {
        heading: "Vos messages",
        items: [
          "Les messages que vous envoyez à un assistant, y compris les images et l'audio ou la transcription des appels, sont transmis à l'entreprise pour qu'elle puisse vous aider, et traités par nos fournisseurs d'IA pour générer les réponses.",
          "Veuillez ne pas communiquer de renseignements personnels sensibles, comme des renseignements de santé, des numéros de carte de paiement, des mots de passe ou des numéros de pièce d'identité.",
          "Les entreprises peuvent consulter les conversations pour améliorer leurs renseignements et faire un suivi avec vous.",
        ],
      },
      {
        heading: "Pour les entreprises qui utilisent Traiblazer",
        items: [
          "Vous êtes responsable des renseignements fournis à votre assistant et de leur exactitude.",
          "Passez en revue les réponses de votre assistant, notamment dans les vues Analyses et Boîte de réception, et corrigez vos renseignements lorsque vous constatez une lacune ou une erreur.",
          "Le contenu que l'assistant rédige pour vous (réponses, publications, texte de page, suivis) est une suggestion. Relisez-le avant de l'envoyer ou de le publier.",
          "Informez vos clients qu'ils parlent à une IA lorsque la loi de votre région l'exige.",
        ],
      },
      {
        heading: "Limitation",
        paragraphs: [
          "Dans la mesure permise par la loi, Traiblazer n'est pas responsable des décisions prises ni des pertes subies en se fiant à une réponse générée par l'IA sans la confirmer auprès de l'entreprise. Cet avis s'ajoute aux conditions qui s'appliquent à votre utilisation du service, sans les remplacer.",
        ],
      },
      {
        heading: "Nous joindre",
        paragraphs: [
          "Des questions sur une réponse de l'assistant d'une entreprise? Communiquez directement avec cette entreprise. Des questions sur la façon dont Traiblazer utilise l'IA? Communiquez avec nous à l'aide des coordonnées au bas de la page.",
        ],
      },
    ],
  },
};
