/** Texts the platform itself sends by SMS, in the assistant's main language (English or French). */
const TEXT = {
  en: {
    textBack: (business: string) =>
      `Sorry we missed your call. This is ${business}'s automated assistant. What can we help you with? Reply STOP to opt out.`,
    callAnswer: (business: string) =>
      `Thanks for calling ${business}. We can't take your call right now. We're sending you a text message so you can tell us what you need.`,
    callAnswerNoText: (business: string) =>
      `Thanks for calling ${business}. We can't take your call right now. Please call back later.`,
    help: (business: string, phone: string | null) =>
      `${business}: automated assistant.${phone ? ` To talk to someone, call ${phone}.` : ""} Reply STOP to stop these messages.`,
    resumed: (business: string) => `You'll get messages from ${business} again. Reply STOP to opt out.`,
    nothingToRead:
      "I couldn't read that message. I can read text and photos (JPEG or PNG, up to 2 MB). What can we help you with?",
    replyQuote: (item: string) => `Reply QUOTE to ask for a quote for ${item}.`,
    replyBook: (item: string) => `Reply BOOK to book ${item}.`,
    bookLink: (item: string, url: string) => `Book ${item}: ${url}`,
    quoteMessage: (item: string) => `I'd like a quote for ${item}.`,
    bookMessage: (item: string) => `I'd like to book ${item}.`,
    limit: (phone: string | null) =>
      `That's a lot of messages for one day, so I'll stop here.${phone ? ` Please call ${phone}.` : ""}`,
    failed: (phone: string | null) =>
      `Sorry, I can't answer right now.${phone ? ` Please call ${phone}.` : " Please try again later."}`,
  },
  fr: {
    textBack: (business: string) =>
      `Désolés d'avoir manqué votre appel. Ici l'assistant automatisé de ${business}. Comment pouvons-nous vous aider ? Répondez ARRET pour ne plus recevoir de messages.`,
    callAnswer: (business: string) =>
      `Merci d'avoir appelé ${business}. Nous ne pouvons pas prendre votre appel en ce moment. Nous vous envoyons un message texte pour que vous puissiez nous dire ce dont vous avez besoin.`,
    callAnswerNoText: (business: string) =>
      `Merci d'avoir appelé ${business}. Nous ne pouvons pas prendre votre appel en ce moment. Veuillez rappeler plus tard.`,
    help: (business: string, phone: string | null) =>
      `${business} : assistant automatisé.${phone ? ` Pour parler à quelqu'un, appelez le ${phone}.` : ""} Répondez ARRET pour ne plus recevoir de messages.`,
    resumed: (business: string) =>
      `Vous recevrez de nouveau les messages de ${business}. Répondez ARRET pour ne plus en recevoir.`,
    nothingToRead:
      "Je n'ai pas pu lire ce message. Je peux lire le texte et les photos (JPEG ou PNG, jusqu'à 2 Mo). Comment pouvons-nous vous aider ?",
    replyQuote: (item: string) => `Répondez SOUMISSION pour demander une soumission pour : ${item}.`,
    replyBook: (item: string) => `Répondez RESERVER pour réserver : ${item}.`,
    bookLink: (item: string, url: string) => `Réserver ${item} : ${url}`,
    quoteMessage: (item: string) => `J'aimerais une soumission pour : ${item}.`,
    bookMessage: (item: string) => `J'aimerais réserver : ${item}.`,
    limit: (phone: string | null) =>
      `Cela fait beaucoup de messages pour une journée, je m'arrête ici.${phone ? ` Veuillez appeler le ${phone}.` : ""}`,
    failed: (phone: string | null) =>
      `Désolé, je ne peux pas répondre pour le moment.${phone ? ` Veuillez appeler le ${phone}.` : " Veuillez réessayer plus tard."}`,
  },
};

export type SmsLanguage = keyof typeof TEXT;
export const smsLanguage = (code: string | null | undefined): SmsLanguage =>
  code?.toLowerCase().startsWith("fr") ? "fr" : "en";
export const smsText = (language: SmsLanguage) => TEXT[language];
