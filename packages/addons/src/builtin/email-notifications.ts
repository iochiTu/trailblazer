import { z } from "zod";
import { type AddonContext, defineAddon } from "../types.js";

const schema = z.object({
  /** Where notifications go. */
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  /** Email when a visitor starts a new conversation. */
  newConversation: z.boolean().default(true),
  /** Email when the assistant couldn't find the answer to a question. */
  unanswered: z.boolean().default(true),
  /** Email when a visitor leaves a request to be contacted (call back, quote, booking…). */
  newRequest: z.boolean().default(true),
});
export type EmailNotificationsConfig = z.infer<typeof schema>;

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const tabLink = (ctx: AddonContext, tab: "conversations" | "requests") =>
  ctx.adminUrl ? `${ctx.adminUrl}/t/${ctx.tenantId}/bots/${ctx.botId}?tab=${tab}` : null;

const TEXT = {
  en: {
    startedSubject: (business: string, message: string) =>
      `New chat on ${business}${message ? `: "${message}"` : ""}`,
    startedIntro: (business: string) =>
      `A visitor started a conversation with the assistant for ${business}.`,
    unansweredSubject: (business: string) => `${business}: a question your assistant couldn't answer`,
    unansweredIntro:
      "Your assistant didn't find the answer to this question in your information. Adding it to your knowledge helps it answer next time.",
    visitor: "Visitor",
    assistant: "Assistant",
    imagesOnly: "(The visitor sent images only.)",
    channel: "Where",
    open: "Open the conversation",
    requestSubject: (business: string, name: string, kind: string) => `${business}: ${name} ${kind}`,
    requestKind: {
      callback: "asked to be contacted",
      quote: "asked for a quote",
      booking: "asked for a booking",
      question: "has a question for you",
      complaint: "has a complaint",
      other: "left a request",
    } as Record<string, string>,
    requestIntro: "A visitor left a request with your assistant and is waiting to hear from you.",
    name: "Name",
    email: "Email",
    phone: "Phone",
    bestTime: "Best time",
    request: "Request",
    photos: (n: number) =>
      n === 1
        ? "The visitor sent 1 photo: see it with the request."
        : `The visitor sent ${n} photos: see them with the request.`,
    openRequests: "Open your requests",
    footer: "You receive this because the Email notifications add-on is installed. Change it in Add-ons.",
  },
  fr: {
    startedSubject: (business: string, message: string) =>
      `Nouvelle conversation pour ${business}${message ? ` : « ${message} »` : ""}`,
    startedIntro: (business: string) =>
      `Un visiteur a commencé une conversation avec l'assistant de ${business}.`,
    unansweredSubject: (business: string) => `${business} : une question restée sans réponse`,
    unansweredIntro:
      "Votre assistant n'a pas trouvé la réponse à cette question dans vos informations. L'ajouter à vos connaissances l'aidera à répondre la prochaine fois.",
    visitor: "Visiteur",
    assistant: "Assistant",
    imagesOnly: "(Le visiteur a envoyé seulement des images.)",
    channel: "Où",
    open: "Ouvrir la conversation",
    requestSubject: (business: string, name: string, kind: string) => `${business} : ${name} ${kind}`,
    requestKind: {
      callback: "demande à être contacté",
      quote: "demande une soumission",
      booking: "demande une réservation",
      question: "a une question pour vous",
      complaint: "a une plainte",
      other: "a laissé une demande",
    } as Record<string, string>,
    requestIntro: "Un visiteur a laissé une demande à votre assistant et attend de vos nouvelles.",
    name: "Nom",
    email: "Courriel",
    phone: "Téléphone",
    bestTime: "Meilleur moment",
    request: "Demande",
    photos: (n: number) =>
      n === 1
        ? "Le visiteur a envoyé 1 photo : voyez-la avec la demande."
        : `Le visiteur a envoyé ${n} photos : voyez-les avec la demande.`,
    openRequests: "Ouvrir vos demandes",
    footer:
      "Vous recevez ce courriel parce que le module Notifications par courriel est installé. Modifiez-le dans Modules.",
  },
};

export const emailNotifications = defineAddon<EmailNotificationsConfig>({
  id: "email-notifications",
  version: 1,
  category: "notifications",
  status: "available",
  icon: "✉️",
  name: { en: "Email notifications", fr: "Notifications par courriel" },
  summary: {
    en: "Get an email when a visitor starts a chat, leaves a request or asks something your assistant can't answer.",
    fr: "Recevez un courriel quand un visiteur commence une conversation, laisse une demande ou pose une question sans réponse.",
  },
  description: {
    en: "Stay on top of your chats without opening the portal. Each email shows the visitor's message and a link to the conversation. Questions your assistant couldn't answer are a good hint of what to add to your knowledge.",
    fr: "Suivez vos conversations sans ouvrir le portail. Chaque courriel montre le message du visiteur et un lien vers la conversation. Les questions sans réponse indiquent quoi ajouter à vos connaissances.",
  },
  capabilities: ["notifications"],
  fields: [
    {
      key: "email",
      type: "email",
      label: { en: "Send to", fr: "Envoyer à" },
      placeholder: "owner@example.com",
      required: true,
      maxLength: 254,
    },
    {
      key: "newConversation",
      type: "toggle",
      label: {
        en: "When a visitor starts a conversation",
        fr: "Quand un visiteur commence une conversation",
      },
    },
    {
      key: "unanswered",
      type: "toggle",
      label: {
        en: "When the assistant can't answer a question",
        fr: "Quand l'assistant ne peut pas répondre à une question",
      },
    },
    {
      key: "newRequest",
      type: "toggle",
      label: {
        en: "When a visitor leaves a request (call back, quote, booking…)",
        fr: "Quand un visiteur laisse une demande (rappel, soumission, réservation…)",
      },
    },
  ],
  schema,
  defaults: { email: "", newConversation: true, unanswered: true, newRequest: true },

  onEvent(event, config, ctx) {
    const t = TEXT[ctx.ownerLanguage];
    const link = tabLink(ctx, "conversations");
    const footer = ["", link ? `${t.open}: ${link}` : null, "", "—", t.footer].filter((l) => l !== null);

    if (event.type === "conversation.started" && config.newConversation) {
      return [
        {
          kind: "email",
          to: [config.email],
          subject: t.startedSubject(ctx.businessName, clip(event.message, 60)),
          text: [
            t.startedIntro(ctx.businessName),
            "",
            `${t.visitor}: ${event.message.trim() || t.imagesOnly}`,
            `${t.channel}: ${event.channel}`,
            ...footer,
          ].join("\n"),
        },
      ];
    }
    if (event.type === "question.unanswered" && config.unanswered) {
      return [
        {
          kind: "email",
          to: [config.email],
          subject: t.unansweredSubject(ctx.businessName),
          text: [
            t.unansweredIntro,
            "",
            `${t.visitor}: ${event.question.trim() || t.imagesOnly}`,
            `${t.assistant}: ${clip(event.answer, 600)}`,
            ...footer,
          ].join("\n"),
        },
      ];
    }
    // Urgent requests are emailed by the platform at once (to this address too), so not twice.
    if (event.type === "request.created" && config.newRequest && !event.urgent) {
      const requests = tabLink(ctx, "requests");
      const line = (label: string, value: string | null) => (value ? `${label}: ${value}` : null);
      return [
        {
          kind: "email",
          to: [config.email],
          subject: t.requestSubject(
            ctx.businessName,
            clip(event.name, 40),
            t.requestKind[event.kind] ?? t.requestKind.other!,
          ),
          text: [
            t.requestIntro,
            "",
            line(t.name, event.name),
            line(t.email, event.email),
            line(t.phone, event.phone),
            line(t.bestTime, event.bestTime),
            ...event.details.map((d) => line(d.label[ctx.ownerLanguage], d.value)),
            line(t.request, event.message.trim()),
            event.photoCount ? t.photos(event.photoCount) : null,
            "",
            requests ? `${t.openRequests}: ${requests}` : null,
            "",
            "—",
            t.footer,
          ]
            .filter((l) => l !== null)
            .join("\n"),
        },
      ];
    }
    return [];
  },
});
