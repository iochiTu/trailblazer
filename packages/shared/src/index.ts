import { AVATAR_ICON_IDS, type AvatarIcon, THEMES } from "@traiblazer/appearance";
import { isSupportedLanguage, normalizeLanguageTag } from "@traiblazer/i18n";
import { INTERVIEW_LIMITS, WORKFLOW_LIMITS as L } from "@traiblazer/industry-packs";
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

/**
 * Friendly page links are <chat-domain>/<slug>: lowercase letters, numbers and dashes, 3–60
 * characters. Words the platform uses (or may use) for its own pages are reserved.
 */
export const PAGE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58})[a-z0-9]$/;
export const RESERVED_PAGE_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "blog",
  "c",
  "chat",
  "chat-assets",
  "dashboard",
  "docs",
  "help",
  "login",
  "logout",
  "operator",
  "pricing",
  "privacy",
  "robots-txt",
  "signup",
  "sitemap",
  "status",
  "support",
  "terms",
  "traiblazer",
  "v1",
  "v2",
  "widget",
  "www",
]);

export const pageSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(PAGE_SLUG_RE, "Use 3–60 lowercase letters, numbers and dashes")
  .refine((slug) => !slug.includes("--"), "Don't use two dashes in a row")
  .refine((slug) => !RESERVED_PAGE_SLUGS.has(slug), "This link is reserved; please choose another");

/** A page link proposed from the business's name ("Smith & Sons Plumbing" → "smith-sons-plumbing"). */
export function suggestPageSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug.length >= 3 && !RESERVED_PAGE_SLUGS.has(slug) ? slug : "";
}

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
        // Requests: let the assistant take a visitor's contact details and request (default) or not.
        followUps: z.boolean(),
        // Business page: business or personal layout; listed in search engines (default) or not.
        page: z.object({ preset: z.enum(["business", "personal"]), listed: z.boolean() }).partial(),
      })
      .partial(),
    /** Friendly page link; null removes it. */
    pageSlug: pageSlugSchema.nullable(),
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

/**
 * A price list, menu or brochure uploaded as a source: a PDF, a Word document (.docx) or a photo
 * (PNG, JPEG, WebP), at most 5 MB. The type is detected from the content, never from the name.
 */
export const MAX_SOURCE_FILE_BYTES = 5 * 1024 * 1024;
/** Uploaded files one assistant can have as sources. */
export const SOURCE_FILE_LIMIT = 20;
export const uploadSourceFileSchema = z.object({
  /** The file's name, for display. */
  name: z.string().trim().min(1).max(200),
  /** Shown in the list of sources; the file's name without its extension when left out. */
  title: z.string().trim().min(1).max(200).optional(),
  /** Base64 without a `data:` prefix. */
  data: z.base64().max(Math.ceil((MAX_SOURCE_FILE_BYTES * 4) / 3) + 4),
});

/**
 * The owner's answers to the setup interview, by question key (see `getInterview` in
 * @traiblazer/industry-packs). An empty answer is a skipped question.
 */
export const interviewAnswersSchema = z.object({
  answers: z.record(z.string().max(40), z.string().max(INTERVIEW_LIMITS.answerLength)),
});
export type InterviewAnswersInput = z.infer<typeof interviewAnswersSchema>;

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

/** Contact buttons on the business page whose taps are counted (same list as the page_stats columns). */
export const PAGE_ACTIONS = ["call", "book", "email", "directions", "website", "link"] as const;
export type PageAction = (typeof PAGE_ACTIONS)[number];

/** A tap on a contact button of the business page, sent by the page itself (no visitor data). */
export const pageEventSchema = z.object({
  publicKey: z.string().regex(/^pk_(live|test)_[A-Za-z0-9_-]{10,64}$/),
  action: z.enum(PAGE_ACTIONS),
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
    /** Business page: one or two sentences under the name. */
    description: z.string().trim().max(300).nullable(),
    serviceArea: z.string().trim().max(300).nullable(),
    /** Licences, certifications, insurance. */
    credentials: z.string().trim().max(300).nullable(),
    /** Service area as data (the assistant's service-area check): towns, and postal code beginnings. */
    serviceTowns: z
      .array(z.string().trim().min(1).max(80))
      .max(100)
      .transform((list) => [...new Set(list)]),
    servicePostalPrefixes: z
      .array(
        z
          .string()
          .transform((code) => code.replace(/[\s-]/g, "").toUpperCase())
          .pipe(
            z
              .string()
              .regex(
                /^[A-Z](\d([A-Z](\d([A-Z]\d?)?)?)?)?$/,
                'Use the start of a Canadian postal code, e.g. "N1H" or "N1"',
              ),
          ),
      )
      .max(200)
      .transform((list) => [...new Set(list)]),
  })
  .partial();
export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

// ---- Business page ---------------------------------------------------------------------------

/** Services and products on the business page. */
export const CATALOG_LIMIT = 60;
export const CATALOG_KINDS = ["service", "product"] as const;
export const CATALOG_ACTIONS = ["ask", "quote", "book"] as const;
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const catalogItemFields = {
  kind: z.enum(CATALOG_KINDS),
  name: z.string().trim().min(1).max(120),
  description: optionalText(500),
  /** The owner's own words: "from $120", "$89.99", "call for a quote". */
  priceText: optionalText(60),
  category: optionalText(60),
  action: z.enum(CATALOG_ACTIONS),
  enabled: z.boolean(),
};
export const createCatalogItemSchema = z.object({
  ...catalogItemFields,
  kind: catalogItemFields.kind.default("service"),
  action: catalogItemFields.action.default("ask"),
  enabled: catalogItemFields.enabled.default(true),
});
export const updateCatalogItemSchema = z.object(catalogItemFields).partial();
export type CreateCatalogItemInput = z.infer<typeof createCatalogItemSchema>;
export const reorderCatalogSchema = z.object({ ids: z.array(z.uuid()).max(CATALOG_LIMIT) });
/** A service or product photo: base64 without a `data:` prefix, at most 2 MB decoded. */
export const catalogPhotoSchema = z.object({
  data: z.base64().max(Math.ceil((2 * 1024 * 1024 * 4) / 3) + 4),
});

/** Time-limited announcements on the page and in answers. */
export const NOTICE_LIMIT = 10;
export const noticeSchema = z
  .object({
    text: z.string().trim().min(1).max(300),
    startsAt: z.iso.datetime({ offset: true }).nullish(),
    endsAt: z.iso.datetime({ offset: true }).nullish(),
  })
  .refine((n) => !n.startsAt || !n.endsAt || new Date(n.endsAt) > new Date(n.startsAt), {
    path: ["endsAt"],
    message: "The end must be after the start",
  });
export type NoticeInput = z.infer<typeof noticeSchema>;

export const addAllowedOriginSchema = z.object({ origin: httpUrl });

// ---- Add-ons ---------------------------------------------------------------------------------

/**
 * Install or change an add-on. `config` is merged over the saved settings and then validated by
 * the add-on's own schema (in @traiblazer/addons), so it is only checked for shape here.
 */
export const updateAddonSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateAddonInput = z.infer<typeof updateAddonSchema>;

/** Requests visitors left for the business: staff move them through these statuses. */
export const LEAD_STATUSES = ["new", "in_progress", "done"] as const;
export const updateLeadSchema = z.object({ status: z.enum(LEAD_STATUSES) });
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

/** Questions the assistant couldn't answer: the business answers them (see `qaPairSchema`) or dismisses them. */
export const updateGapSchema = z.object({ status: z.enum(["open", "dismissed"]) });
export type UpdateGapInput = z.infer<typeof updateGapSchema>;

/**
 * What the owner keeps from the setup assistant's suggestion, after editing it. Each part is
 * optional: a part left out isn't changed.
 */
/** Services and products the setup assistant proposes in one run, at most. */
export const SETUP_SERVICES_LIMIT = 20;
export const applySetupSchema = z.object({
  profile: businessProfileSchema.optional(),
  greeting: z.record(z.string(), z.string().trim().max(300)).optional(),
  quickReplies: z.record(z.string(), z.array(z.string().trim().min(1).max(120)).max(6)).optional(),
  /** Answers the owner wrote to questions their information didn't cover (saved as Q&A answers). */
  answers: z.array(qaPairSchema).max(10).optional(),
  /** The proposed services and products the owner kept: added to the business page. */
  services: z.array(createCatalogItemSchema).max(SETUP_SERVICES_LIMIT).optional(),
});
export type ApplySetupInput = z.infer<typeof applySetupSchema>;

// ---- Prospect demos (operator console) --------------------------------------------------------

/**
 * A demo page for a business that isn't a customer yet, built from its public information: its
 * website, and text pasted from its Google listing or Facebook page. At least one is needed.
 */
export const createDemoSchema = z
  .object({
    businessName: z.string().trim().min(1).max(120),
    pack: z.string().trim().min(1).max(60),
    variant: z.string().trim().min(1).max(60).nullish(),
    /** Language of the page and of the assistant's first greeting; the chat answers in both. */
    language: z.enum(["en", "fr"]).default("en"),
    websiteUrl: httpUrl.nullish(),
    text: z
      .string()
      .trim()
      .max(50_000)
      .nullish()
      .transform((value) => value || null),
    /** The operator's own note (contact, where the lead came from). Never shown on the page. */
    note: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((value) => value || null),
  })
  .refine((demo) => demo.websiteUrl || demo.text, {
    path: ["websiteUrl"],
    message: "Add the business's website, or paste text from its Google listing or Facebook page",
  });
export type CreateDemoInput = z.infer<typeof createDemoSchema>;

/** Hands a demo over to the owner's account (which must already exist). */
export const handOverDemoSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
});

export * from "./plans.js";
