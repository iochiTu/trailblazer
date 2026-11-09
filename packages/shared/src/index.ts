import { AVATAR_ICON_IDS, type AvatarIcon, THEMES } from "@traiblazer/appearance";
import { isSupportedLanguage, normalizeLanguageTag } from "@traiblazer/i18n";
import { WORKFLOW_LIMITS as L } from "@traiblazer/industry-packs";
import { z } from "zod";

const avatarSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("initials") }),
  z.object({ kind: z.literal("icon"), icon: z.enum(AVATAR_ICON_IDS as [AvatarIcon, ...AvatarIcon[]]) }),
  z.object({ kind: z.literal("image"), assetId: z.uuid() }),
]);

/** Request/response schemas shared by the API and the admin portal. */

export const MIN_PASSWORD_LENGTH = 10;

const languageCode = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const code = normalizeLanguageTag(value);
    if (!code || !isSupportedLanguage(code)) {
      ctx.addIssue({ code: "custom", message: `Unsupported language: ${value}` });
      return z.NEVER;
    }
    return code as string;
  });

const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);

export const signupSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  name: z.string().trim().min(1).max(120),
  uiLanguage: languageCode.optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createTenantSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ownerLanguage: languageCode.optional(),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

const languagesList = z
  .array(languageCode)
  .min(1)
  .max(30)
  .transform((list) => [...new Set(list)]);

export const createBotSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    pack: z.string().trim().min(1).max(60),
    variant: z.string().trim().min(1).max(60).nullish(),
    languages: languagesList.optional(),
    defaultLanguage: languageCode.optional(),
    allowedOrigins: z.array(httpUrl).max(20).optional(),
    /** Activate the web version (chat page by link/QR code) right away, e.g. for businesses without a website. */
    hostedPageEnabled: z.boolean().optional(),
  })
  .refine((b) => !b.defaultLanguage || !b.languages || b.languages.includes(b.defaultLanguage), {
    message: "defaultLanguage must be one of languages",
    path: ["defaultLanguage"],
  });
export type CreateBotInput = z.infer<typeof createBotSchema>;

/** A business's workflow: a playbook the assistant follows when a visitor's request matches `when`. */
export const workflowSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Use lowercase letters, numbers and dashes for workflow ids"),
  name: z.string().trim().min(1).max(L.nameLength),
  enabled: z.boolean(),
  when: z.string().trim().min(1).max(L.whenLength),
  steps: z.array(z.string().trim().min(1).max(L.stepLength)).min(1).max(L.maxSteps),
  finish: z.string().trim().max(L.finishLength),
  template: z.string().max(64).optional(),
});
export type WorkflowInput = z.infer<typeof workflowSchema>;

export const workflowsSchema = z
  .array(workflowSchema)
  .max(L.maxWorkflows)
  .refine((list) => new Set(list.map((w) => w.id)).size === list.length, {
    message: "Workflow ids must be unique",
  });

export const updateBotSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    variant: z.string().trim().min(1).max(60).nullable(),
    status: z.enum(["draft", "active", "paused"]),
    languages: languagesList,
    defaultLanguage: languageCode,
    persona: z.string().trim().max(2000).nullable(),
    /** How the assistant responds (starts as the industry template's guidelines). */
    guidelines: z.string().trim().max(L.guidelinesLength),
    workflows: workflowsSchema,
    hostedPageEnabled: z.boolean(),
    settings: z
      .object({
        // Limited: one of the designed templates and a brand color (text colors are derived).
        theme: z.enum(THEMES),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #1f6f5c"),
        // Fully customizable: the assistant's name, picture, greeting and launcher label.
        // Empty = use the business name.
        assistantName: z.string().trim().max(40),
        avatar: avatarSchema,
        greeting: z.record(z.string(), z.string().trim().max(300)),
        quickReplies: z.record(z.string(), z.array(z.string().trim().min(1).max(120)).max(6)),
        launcherLabel: z.string().trim().max(30),
        launcherPosition: z.enum(["right", "left"]),
        // Languages: answer visitors in languages that aren't turned on (default) or not.
        answerOtherLanguages: z.boolean(),
      })
      .partial(),
  })
  .partial();

/** Uploaded images: base64 data, at most 512 KB once decoded (PNG, JPEG or WebP; checked by content). */
export const MAX_ASSET_BYTES = 512 * 1024;
export const assetUploadSchema = z.object({
  kind: z.enum(["avatar"]),
  data: z.base64().max(Math.ceil((MAX_ASSET_BYTES * 4) / 3) + 4),
});
export type UpdateBotInput = z.infer<typeof updateBotSchema>;

// ---- Knowledge -------------------------------------------------------------------------------

export const createSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("website"),
    url: httpUrl,
    title: z.string().trim().min(1).max(200).optional(),
    maxPages: z.number().int().min(1).max(500).optional(),
  }),
  z.object({
    type: z.literal("text"),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(50_000),
  }),
]);
export type CreateSourceInput = z.infer<typeof createSourceSchema>;

export const updateTextSourceSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(50_000),
  })
  .partial()
  .refine((v) => v.title !== undefined || v.content !== undefined, { message: "Nothing to update" });
export type UpdateTextSourceInput = z.infer<typeof updateTextSourceSchema>;

export const qaPairSchema = z.object({
  question: z.string().trim().min(3).max(500),
  answer: z.string().trim().min(1).max(4000),
  language: languageCode.optional(),
});
export type QaPairInput = z.infer<typeof qaPairSchema>;

// ---- Public chat -----------------------------------------------------------------------------

/** Business photos for the knowledge base (shown to visitors in answers). */
export const MAX_KNOWLEDGE_IMAGE_BYTES = 2 * 1024 * 1024;
export const knowledgeImageFields = {
  title: z.string().trim().min(1).max(120),
  /** What the photo shows; the assistant reads this to decide when to show it. */
  description: z.string().trim().min(3).max(1000),
  enabled: z.boolean(),
};
export const createKnowledgeImageSchema = z.object({
  title: knowledgeImageFields.title,
  description: knowledgeImageFields.description,
  /** Base64 without a `data:` prefix. */
  data: z.base64().max(Math.ceil((MAX_KNOWLEDGE_IMAGE_BYTES * 4) / 3) + 4),
});
export const updateKnowledgeImageSchema = z.object(knowledgeImageFields).partial();

/** Images a visitor can attach to one chat message, and the largest size of each (decoded). */
export const MAX_CHAT_IMAGES = 3;
export const MAX_CHAT_IMAGE_BYTES = 2 * 1024 * 1024;

export const chatImageSchema = z.object({
  /** File name for display; the type is detected from the content, never from the name. */
  name: z.string().trim().min(1).max(200),
  /** Base64 without a `data:` prefix. */
  data: z.base64().max(Math.ceil((MAX_CHAT_IMAGE_BYTES * 4) / 3) + 4),
});

export const publicChatSchema = z
  .object({
    publicKey: z.string().regex(/^pk_(live|test)_[A-Za-z0-9_-]{10,64}$/),
    conversationId: z.uuid().nullish(),
    visitorId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
    message: z.string().trim().max(2000).default(""),
    images: z.array(chatImageSchema).max(MAX_CHAT_IMAGES).default([]),
    channel: z.enum(["hosted", "inline", "widget", "playground"]).default("hosted"),
    pageUrl: z.string().max(2000).nullish(),
  })
  .refine((input) => input.message.length > 0 || input.images.length > 0, {
    path: ["message"],
    message: "Write a message or attach an image",
  });
export type PublicChatInput = z.infer<typeof publicChatSchema>;

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");
const dayHours = z.array(z.object({ open: timeOfDay, close: timeOfDay })).max(4);

export const businessProfileSchema = z
  .object({
    businessName: z.string().trim().max(200).nullable(),
    phone: z.string().trim().max(40).nullable(),
    email: z.email().max(254).nullable(),
    websiteUrl: httpUrl.nullable(),
    address: z.record(z.string(), z.string().max(200)).nullable(),
    timezone: z.string().max(64),
    hours: z
      .object({
        mon: dayHours,
        tue: dayHours,
        wed: dayHours,
        thu: dayHours,
        fri: dayHours,
        sat: dayHours,
        sun: dayHours,
      })
      .partial()
      .nullable(),
    staffLanguages: z.array(languageCode).max(30),
    bookingUrl: httpUrl.nullable(),
    orderingUrl: httpUrl.nullable(),
  })
  .partial();
export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

export const addAllowedOriginSchema = z.object({ origin: httpUrl });

export * from "./plans.js";
