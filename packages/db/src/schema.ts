import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Postgres full-text vector. Written with sql`to_tsvector(...)`, never read back by the app. */
const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/**
 * pgvector column without fixed dimensions, so different embedding models can coexist; rows record
 * `embedding_model` and searches only compare rows of the same model.
 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector",
  toDriver: (value) => `[${value.join(",")}]`,
  fromDriver: (value) => JSON.parse(value) as number[],
});

/** Binary data (postgres-js returns Buffer). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/*
 * Tenancy model
 * -------------
 * - Platform tables (tenants, users, sessions, memberships) are read by the auth/tenancy layer only.
 * - Tenant-owned tables carry `tenant_id` and are protected by Postgres row-level security
 *   (see migrations/0001_rls.sql). The API connects as `traiblazer_app`, which cannot bypass RLS,
 *   and sets `app.tenant_id` per transaction via `withTenant()`.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------------------------
// Platform tables (no RLS)
// ---------------------------------------------------------------------------------------------

/**
 * Plans, managed by platform operators in the operator console. Allowances are enforced by the chat
 * guard; prices are for display (billing comes later).
 */
export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  nameEn: text("name_en").notNull(),
  nameFr: text("name_fr").notNull(),
  /** Visitor questions answered per calendar month. */
  monthlyQuestions: integer("monthly_questions").notNull(),
  /** Answers generated at the same time for one business. */
  concurrent: integer("concurrent").notNull(),
  /** Questions per minute for one business (all visitors together). */
  perMinute: integer("per_minute").notNull(),
  /** Photos one assistant can keep in its knowledge base (shown to visitors in answers). */
  knowledgeImages: integer("knowledge_images").notNull().default(50),
  /** Monthly price in CAD cents, for display. */
  priceMonthlyCents: integer("price_monthly_cents"),
  /** Archived plans keep working for existing businesses but can't be assigned anymore. */
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const tenantStatuses = ["active", "suspended"] as const;
export type TenantStatus = (typeof tenantStatuses)[number];

/**
 * "demo": a page operators built from a prospect's public information to show at first contact
 * (see `demos`). It has no members, its page carries a demo notice and is never listed by search
 * engines. It becomes a "business" when it is handed over to the owner's account.
 */
export const tenantKinds = ["business", "demo"] as const;
export type TenantKind = (typeof tenantKinds)[number];

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  kind: text("kind").$type<TenantKind>().notNull().default("business"),
  plan: text("plan")
    .notNull()
    .default("trial")
    .references(() => plans.id, { onUpdate: "cascade", onDelete: "restrict" }),
  /** "suspended" turns the business's assistants off for visitors (set by operators). */
  status: text("status").$type<TenantStatus>().notNull().default("active"),
  /** Language the business owner reads (inbox translations go into this language). */
  ownerLanguage: text("owner_language").notNull().default("en"),
  /** "default" or "canada" (data residency, Phase 3). */
  dataRegion: text("data_region").notNull().default("default"),
  /** Owner's own monthly question cap (cost control); never above the plan's allowance. Null = plan limit. */
  monthlyQuestionLimit: integer("monthly_question_limit"),
  /** Max questions one visitor may ask per day across this business's assistants. Null = default. */
  visitorDailyLimit: integer("visitor_daily_limit"),
  ...timestamps,
});

export const platformRoles = ["super_admin"] as const;
export type PlatformRole = (typeof platformRoles)[number];

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Always stored lower-cased. */
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  uiLanguage: text("ui_language").notNull().default("en"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  /**
   * Traiblazer staff role (null for every business user). Super admins use the operator console and
   * can support any business. Granted only from the command line (`pnpm --filter @traiblazer/api
   * superadmin grant <email>`), never through the API. Staff accounts can't belong to businesses
   * (enforced by a database trigger), so a business login can never reach the console.
   */
  platformRole: text("platform_role").$type<PlatformRole>(),
  ...timestamps,
});

/** Platform-wide policies (key → JSON value), managed in the operator console. */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * building: sources are being read and the page filled in; ready: review it, then share the link;
 * needs_information: nothing could be read from the sources; failed: the setup assistant couldn't
 * run (the page exists, with the name only); handed_over: now the owner's business.
 */
export const demoStatuses = ["building", "ready", "needs_information", "failed", "handed_over"] as const;
export type DemoStatus = (typeof demoStatuses)[number];

/**
 * Prospect demos (operator console): one row per demo page built for a business that isn't a
 * customer yet. Platform table, read and written by operators and the worker only; everything the
 * demo contains lives in its own tenant (kind "demo"), under row-level security like any business.
 */
export const demos = pgTable(
  "demos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .unique()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    status: text("status").$type<DemoStatus>().notNull().default("building"),
    /** Why it isn't ready: "no_information", or the setup assistant's error code. */
    error: text("error"),
    /** The operator's own note (who to contact, where the lead came from). Never shown on the page. */
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Account the business was handed over to. */
    handedOverTo: text("handed_over_to"),
    handedOverAt: timestamp("handed_over_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("demos_created_idx").on(t.createdAt)],
);

/** Who changed what in the operator console (plans, policies, business plan/status). */
export const operatorAuditLogs = pgTable(
  "operator_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("operator_audit_logs_created_idx").on(t.createdAt)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the session token; the raw token only lives in the user's cookie. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const memberRoles = ["owner", "admin", "editor", "viewer"] as const;
export type MemberRole = (typeof memberRoles)[number];

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<MemberRole>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_tenant_user_uq").on(t.tenantId, t.userId),
    index("memberships_user_id_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------------------------------------
// Tenant-owned tables (RLS enforced)
// ---------------------------------------------------------------------------------------------

/** Chat appearance and wording (validated by @traiblazer/shared; see @traiblazer/appearance). */
export interface BotSettings {
  /** Design template id, e.g. "classic", "minimal", "friendly", "bold", "midnight". */
  theme?: string;
  /** Brand color for the chat header and launcher, e.g. "#1f6f5c". */
  color?: string;
  /** Name the assistant shows to visitors (any text, any language). */
  assistantName?: string;
  /** Assistant picture: initials, a built-in icon, or an uploaded image asset. */
  avatar?: { kind: "initials" } | { kind: "icon"; icon: string } | { kind: "image"; assetId: string };
  /** Greeting per language code; falls back to a default greeting. */
  greeting?: Record<string, string>;
  /** Suggested first questions per language code. */
  quickReplies?: Record<string, string[]>;
  /** Optional text next to the widget's launcher button. */
  launcherLabel?: string;
  launcherPosition?: "right" | "left";
  /**
   * Answer visitors who write in a language the owner hasn't turned on (default true). When false,
   * those visitors get answers in the default language.
   */
  answerOtherLanguages?: boolean;
  /**
   * Let the assistant take a visitor's contact details and request and pass them to the business
   * (default true). See `leads`.
   */
  followUps?: boolean;
  /** The business page (the web version as the business's public page, PLAN §7.1). */
  page?: PageSettings;
}

/** "business": logo, one or more people; "personal": one person (a solo contractor). */
export const pagePresets = ["business", "personal"] as const;
export type PagePreset = (typeof pagePresets)[number];

export interface PageSettings {
  preset?: PagePreset;
  /**
   * Let search engines list the page (default true). Only an active assistant with its web version
   * on is ever listed; an owner can keep the page unlisted (reachable by link only).
   */
  listed?: boolean;
}

/**
 * A playbook the assistant follows when a visitor's request matches `when`. Copied from the
 * industry template when the assistant is created, then owned by the business. Same shape as
 * `Workflow` in @traiblazer/industry-packs.
 */
export interface BotWorkflow {
  id: string;
  name: string;
  enabled: boolean;
  when: string;
  steps: string[];
  finish: string;
  /** Template workflow this one was copied from, if any. */
  template?: string;
}

export const botStatuses = ["draft", "active", "paused"] as const;
export type BotStatus = (typeof botStatuses)[number];

export const botAudiences = ["public", "staff", "members"] as const;
export type BotAudience = (typeof botAudiences)[number];

export const bots = pgTable(
  "bots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Industry template it was created from, e.g. "restaurant", and optional variant, e.g. "pub". */
    pack: text("pack").notNull(),
    variant: text("variant"),
    packVersion: integer("pack_version").notNull().default(1),
    audience: text("audience").$type<BotAudience>().notNull().default("public"),
    status: text("status").$type<BotStatus>().notNull().default("draft"),
    /** Enabled answer languages (BCP 47 codes from the language registry). */
    languages: text("languages").array().notNull().default(sql`ARRAY['en']::text[]`),
    defaultLanguage: text("default_language").notNull().default("en"),
    modelProfile: text("model_profile").notNull().default("default"),
    persona: text("persona"),
    /**
     * How the assistant responds, and its workflows. Copied from the industry template when the
     * assistant is created and then edited by the business. NULL (assistants created before
     * templates were copied) = follow the template until edited.
     */
    guidelines: text("guidelines"),
    workflows: jsonb("workflows").$type<BotWorkflow[]>(),
    /**
     * "Web version": the business's own chat page at /c/<key>, reached by link or QR code — for
     * businesses (e.g. independent contractors) without a website. Off until the owner activates it;
     * embedding on the business's allowed websites works either way.
     */
    hostedPageEnabled: boolean("hosted_page_enabled").notNull().default(false),
    /**
     * Friendly link to the business page, e.g. "smith-plumbing" for <chat-domain>/smith-plumbing.
     * Unique across the platform; NULL = only the /c/<public-key> link. Unlike the key, it
     * survives key rotation.
     */
    pageSlug: text("page_slug"),
    settings: jsonb("settings").$type<BotSettings>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index("bots_tenant_id_idx").on(t.tenantId),
    uniqueIndex("bots_page_slug_uq").on(t.pageSlug),
    // Lets child tables reference (bot_id, tenant_id) together, so a row can never point at
    // another tenant's bot (plain FK checks ignore row-level security).
    unique("bots_id_tenant_uq").on(t.id, t.tenantId),
  ],
);

export const botKeys = pgTable(
  "bot_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    /** Public widget key (not a secret). Requests are additionally checked against allowed origins. */
    publicKey: text("public_key").notNull().unique(),
    allowedOrigins: text("allowed_origins").array().notNull().default(sql`ARRAY[]::text[]`),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bot_keys_tenant_id_idx").on(t.tenantId),
    index("bot_keys_bot_id_idx").on(t.botId),
    foreignKey({
      name: "bot_keys_bot_tenant_fk",
      columns: [t.botId, t.tenantId],
      foreignColumns: [bots.id, bots.tenantId],
    }).onDelete("cascade"),
  ],
);

export type WeeklyHours = Partial<
  Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", { open: string; close: string }[]>
>;

export const businessProfiles = pgTable(
  "business_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull().unique(),
    businessName: text("business_name"),
    phone: text("phone"),
    email: text("email"),
    websiteUrl: text("website_url"),
    address: jsonb("address").$type<Record<string, string>>(),
    timezone: text("timezone").notNull().default("America/Toronto"),
    hours: jsonb("hours").$type<WeeklyHours>(),
    staffLanguages: text("staff_languages").array().notNull().default(sql`ARRAY[]::text[]`),
    bookingUrl: text("booking_url"),
    orderingUrl: text("ordering_url"),
    /** One or two sentences under the name on the business page (and in search results). */
    description: text("description"),
    /** Towns, neighbourhoods or postal areas served, in the owner's words. */
    serviceArea: text("service_area"),
    /** Licences, certifications and insurance, shown in the page footer when given. */
    credentials: text("credentials"),
    /**
     * Service area as data, for the assistant's service-area check: town names, and postal code
     * beginnings (e.g. "N1H", or "N1" for every code starting with it). `serviceArea` is the
     * owner's own wording, shown on the page.
     */
    serviceTowns: text("service_towns").array().notNull().default(sql`ARRAY[]::text[]`),
    servicePostalPrefixes: text("service_postal_prefixes").array().notNull().default(sql`ARRAY[]::text[]`),
    ...timestamps,
  },
  (t) => [
    index("business_profiles_tenant_id_idx").on(t.tenantId),
    foreignKey({
      name: "business_profiles_bot_tenant_fk",
      columns: [t.botId, t.tenantId],
      foreignColumns: [bots.id, bots.tenantId],
    }).onDelete("cascade"),
  ],
);

/**
 * Add-ons installed on an assistant from the add-on market (definitions live in
 * @traiblazer/addons). `config` is validated by the add-on's schema on every save and read;
 * `config_version` is the add-on version that saved it, so later versions can migrate it.
 * Credentials for integrations (OAuth tokens, API keys) don't belong in `config`: they live sealed
 * in `integration_connections`, which a CRM add-on names by its connector id.
 */
export const botAddons = pgTable(
  "bot_addons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    addonId: text("addon_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    configVersion: integer("config_version").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("bot_addons_bot_addon_uq").on(t.botId, t.addonId),
    index("bot_addons_tenant_bot_idx").on(t.tenantId, t.botId),
    foreignKey({
      name: "bot_addons_bot_tenant_fk",
      columns: [t.botId, t.tenantId],
      foreignColumns: [bots.id, bots.tenantId],
    }).onDelete("cascade"),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

// ---------------------------------------------------------------------------------------------
// Knowledge (RLS enforced)
// ---------------------------------------------------------------------------------------------

/** file: an uploaded price list or brochure (PDF, Word document or photo), read once into text. */
export const sourceTypes = ["website", "text", "qa", "file"] as const;
export type SourceType = (typeof sourceTypes)[number];
/** Files a business can upload as a source; the type is detected from the content. */
export const sourceFileTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export type SourceFileType = (typeof sourceFileTypes)[number];
export const sourceStatuses = ["pending", "processing", "ready", "failed"] as const;
export type SourceStatus = (typeof sourceStatuses)[number];

export interface SourceSettings {
  /** Website crawl: maximum pages to fetch. */
  maxPages?: number;
  /** Uploaded file: its name as uploaded, its detected type and its size. */
  file?: { name: string; contentType: SourceFileType; sizeBytes: number };
  /**
   * The setup interview (a text source): the owner's answers by question key. The source's text is
   * written from them, so it is edited through the interview, not as pasted text.
   */
  interview?: { answers: Record<string, string> };
}

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    type: text("type").$type<SourceType>().notNull(),
    title: text("title").notNull(),
    /** Website: start URL. */
    url: text("url"),
    /** Text sources: the owner's text. File sources: the text read from the file. */
    content: text("content"),
    status: text("status").$type<SourceStatus>().notNull().default("pending"),
    error: text("error"),
    settings: jsonb("settings").$type<SourceSettings>().notNull().default({}),
    documentCount: integer("document_count").notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("knowledge_sources_bot_idx").on(t.tenantId, t.botId),
    unique("knowledge_sources_id_tenant_uq").on(t.id, t.tenantId),
    foreignKey({
      name: "knowledge_sources_bot_tenant_fk",
      columns: [t.botId, t.tenantId],
      foreignColumns: [bots.id, bots.tenantId],
    }).onDelete("cascade"),
  ],
);

/**
 * An uploaded file waiting to be read by the worker. Private: never served to anyone. The row is
 * removed once the text has been read into the source (and with the source, if that is deleted).
 */
export const sourceFiles = pgTable(
  "source_files",
  {
    sourceId: uuid("source_id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contentType: text("content_type").$type<SourceFileType>().notNull(),
    bytes: bytea("bytes").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "source_files_source_tenant_fk",
      columns: [t.sourceId, t.tenantId],
      foreignColumns: [knowledgeSources.id, knowledgeSources.tenantId],
    }).onDelete("cascade"),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    url: text("url"),
    title: text("title"),
    language: text("language"),
    /** SHA-256 of the extracted text; unchanged pages are not re-chunked on re-sync. */
    contentHash: text("content_hash").notNull(),
    content: text("content").notNull(),
    ...timestamps,
  },
  (t) => [
    index("documents_source_idx").on(t.sourceId),
    uniqueIndex("documents_source_url_uq").on(t.sourceId, t.url),
    unique("documents_id_tenant_uq").on(t.id, t.tenantId),
    foreignKey({
      name: "documents_source_tenant_fk",
      columns: [t.sourceId, t.tenantId],
      foreignColumns: [knowledgeSources.id, knowledgeSources.tenantId],
    }).onDelete("cascade"),
  ],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    documentId: uuid("document_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    heading: text("heading"),
    content: text("content").notNull(),
    language: text("language"),
    tsv: tsvector("tsv").notNull(),
    embedding: vector("embedding"),
    embeddingModel: text("embedding_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chunks_bot_idx").on(t.botId),
    index("chunks_document_idx").on(t.documentId),
    index("chunks_tsv_idx").using("gin", t.tsv),
    index("chunks_content_trgm_idx").using("gin", sql`${t.content} gin_trgm_ops`),
    foreignKey({
      name: "chunks_document_tenant_fk",
      columns: [t.documentId, t.tenantId],
      foreignColumns: [documents.id, documents.tenantId],
    }).onDelete("cascade"),
  ],
);

export const qaPairs = pgTable(
  "qa_pairs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    language: text("language").notNull().default("en"),
    enabled: boolean("enabled").notNull().default(true),
    tsv: tsvector("tsv").notNull(),
    ...timestamps,
  },
  (t) => [
    index("qa_pairs_bot_idx").on(t.botId),
    index("qa_pairs_tsv_idx").using("gin", t.tsv),
    index("qa_pairs_question_trgm_idx").using("gin", sql`${t.question} gin_trgm_ops`),
    foreignKey({
      name: "qa_pairs_bot_tenant_fk",
      columns: [t.botId, t.tenantId],
      foreignColumns: [bots.id, bots.tenantId],
    }).onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------------------------
// Conversations & usage (RLS enforced)
// ---------------------------------------------------------------------------------------------

export const channels = ["hosted", "inline", "widget", "playground"] as const;
export type Channel = (typeof channels)[number];

/**
 * Photos the business adds to its knowledge base (menu, storefront, parking map, products). The
 * owner's title and description are what the assistant searches and reads; the image itself lives
 * in `assets` (kind "knowledge_image") and is public, like anything on the business's website.
 */
export const knowledgeImages = pgTable(
  "knowledge_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    language: text("language"),
    enabled: boolean("enabled").notNull().default(true),
    tsv: tsvector("tsv").notNull(),
    ...timestamps,
  },
  (t) => [
    index("knowledge_images_bot_idx").on(t.tenantId, t.botId),
    index("knowledge_images_tsv_idx").using("gin", t.tsv),
    foreignKey({
      name: "knowledge_images_bot_tenant_fk",
      columns: [t.botId, t.tenantId],
      foreignColumns: [bots.id, bots.tenantId],
    }).onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------------------------
// Business page (RLS enforced)
// ---------------------------------------------------------------------------------------------

export const catalogKinds = ["service", "product"] as const;
export type CatalogKind = (typeof catalogKinds)[number];
/** What the card's main button does: ask the assistant about it, request a quote, or book. */
export const catalogActions = ["ask", "quote", "book"] as const;
export type CatalogAction = (typeof catalogActions)[number];

/**
 * Services and products the business offers, kept by the owner: shown as cards on the business
 * page and listed for the assistant. Prices are the owner's own text ("from $120", "call for a
 * quote"); nothing here is ever filled in by a model without the owner's review.
 */
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    kind: text("kind").$type<CatalogKind>().notNull().default("service"),
    name: text("name").notNull(),
    description: text("description"),
    priceText: text("price_text"),
    /** Cards with the same category are shown together. */
    category: text("category"),
    /** Photo (asset kind "catalog_image"); public, like the rest of the page. */
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    action: text("action").$type<CatalogAction>().notNull().default("ask"),
    /** Order on the page, smallest first. */
    position: integer("position").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("catalog_items_bot_idx").on(t.tenantId, t.botId, t.position),
    foreignKey({
      name: "catalog_items_bot_tenant_fk",
      columns: [t.botId, t.tenantId],
      foreignColumns: [bots.id, bots.tenantId],
    }).onDelete("cascade"),
  ],
);

/**
 * Time-limited announcements ("closed Monday for the holiday", "booking tire changeovers now"),
 * shown at the top of the business page and known to the assistant while they run. No start =
 * from now on; no end = until removed.
 */
export const notices = pgTable(
  "notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    text: text("text").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("notices_bot_idx").on(t.tenantId, t.botId),
    foreignKey({
      name: "notices_bot_tenant_fk",
      columns: [t.botId, t.tenantId],
      foreignColumns: [bots.id, bots.tenantId],
    }).onDelete("cascade"),
  ],
);

/** Contact buttons on the business page whose taps are counted (see `page_stats`). */
export const pageActions = ["call", "book", "email", "directions", "website", "link"] as const;
export type PageAction = (typeof pageActions)[number];

/**
 * Daily counts for the business page: views of the page and taps on its contact buttons. Totals
 * only, by day in the reporting time zone: no visitor, address or device is recorded.
 */
export const pageStats = pgTable(
  "page_stats",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    views: integer("views").notNull().default(0),
    call: integer("call").notNull().default(0),
    book: integer("book").notNull().default(0),
    email: integer("email").notNull().default(0),
    directions: integer("directions").notNull().default(0),
    website: integer("website").notNull().default(0),
    /** Add-on buttons (online shop and other links). */
    link: integer("link").notNull().default(0),
  },
  (t) => [
    primaryKey({ name: "page_stats_pk", columns: [t.tenantId, t.botId, t.day] }),
    foreignKey({
      name: "page_stats_bot_tenant_fk",
      columns: [t.botId, t.tenantId],
      foreignColumns: [bots.id, bots.tenantId],
    }).onDelete("cascade"),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    channel: text("channel").$type<Channel>().notNull(),
    /** Random id kept in the visitor's browser; not linked to any personal data. */
    visitorId: text("visitor_id").notNull(),
    language: text("language"),
    /** Page the widget was opened on (embedding site), when known. */
    pageUrl: text("page_url"),
    messageCount: integer("message_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversations_bot_last_idx").on(t.tenantId, t.botId, t.lastMessageAt),
    index("conversations_visitor_idx").on(t.tenantId, t.visitorId),
    unique("conversations_id_tenant_uq").on(t.id, t.tenantId),
    foreignKey({
      name: "conversations_bot_tenant_fk",
      columns: [t.botId, t.tenantId],
      foreignColumns: [bots.id, bots.tenantId],
    }).onDelete("cascade"),
  ],
);

export interface Citation {
  title: string | null;
  url: string | null;
  kind: "page" | "text" | "qa";
}

/** A business photo shown in an assistant reply (from the knowledge base; public). */
export interface ReplyImage {
  /** knowledge_images.id */
  id: string;
  assetId: string;
  title: string;
}

/** A button under an assistant reply; the link always comes from the business profile, never the model. */
export interface ReplyAction {
  kind: "call" | "book";
  href: string;
}

export interface MessageFlags {
  /**
   * The assistant couldn't answer from the business's information and said so (it marked the reply
   * with what was missing; see `knowledge_gaps`).
   */
  unanswered?: boolean;
  /** The model or the fallback chain declined. */
  refused?: boolean;
  /**
   * The model's reply gave away its instructions or tools (a visitor tried to get them): it was
   * replaced with a short "I can only help with questions about this business".
   */
  withheld?: boolean;
  error?: boolean;
  /** Every AI provider route was at capacity; the visitor was asked to try again shortly. */
  busy?: boolean;
  /** The visitor sent images but no available model could look at them. */
  imagesUnseen?: boolean;
  /**
   * Triage of the visitor's message: "danger" (a danger to life: gas, carbon monoxide, fire) or
   * "urgent" (a problem that can't wait, by the industry's rules). The chat showed the phone
   * number at once.
   */
  urgency?: "urgent" | "danger";
  /** The visitor asked for professional advice or a diagnosis; the assistant was told to decline. */
  advice?: boolean;
  /** Buttons shown under the reply ("call", "book"). */
  actions?: ReplyAction[];
  /** Tools the assistant used for this answer (e.g. "search_knowledge"). */
  tools?: string[];
}

// ---------------------------------------------------------------------------------------------
// Requests from visitors (RLS enforced)
// ---------------------------------------------------------------------------------------------

/** What the visitor wants the business to do. */
export const leadKinds = ["callback", "quote", "booking", "question", "complaint", "other"] as const;
export type LeadKind = (typeof leadKinds)[number];
export const leadStatuses = ["new", "in_progress", "done"] as const;
export type LeadStatus = (typeof leadStatuses)[number];

/**
 * A request a visitor left for the business to follow up on ("call me back", "send me a quote"),
 * saved by the assistant with the contact details the visitor typed. Personal data: shown only to
 * the business's members, deleted with the assistant, and deletable one by one.
 */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    /**
     * Conversation it came from. Not a foreign key: the request is kept if the conversation is
     * later removed, and reads are tenant-scoped either way.
     */
    conversationId: uuid("conversation_id"),
    /** "playground" = left by the owner while testing; never notified. */
    channel: text("channel").$type<Channel>().notNull(),
    kind: text("kind").$type<LeadKind>().notNull(),
    status: text("status").$type<LeadStatus>().notNull().default("new"),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    /** When or how the visitor prefers to be reached, in their words. */
    bestTime: text("best_time"),
    /** What the visitor wants, summarised by the assistant for staff. */
    message: text("message").notNull(),
    /** Language the visitor was writing in. */
    language: text("language"),
    /** A problem that can't wait (by the industry's triage rules or the assistant's judgement). */
    urgent: boolean("urgent").notNull().default(false),
    /**
     * The industry's request fields the visitor gave (e.g. { vehicle: "2018 Honda Civic",
     * tireSize: "215/55R16" }); keys come from the industry template's `leadFields`.
     */
    details: jsonb("details").$type<Record<string, string>>().notNull().default({}),
    /** Photos the visitor sent in the conversation (message_attachments ids), shown with the request. */
    attachmentIds: uuid("attachment_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
    ...timestamps,
  },
  (t) => [
    index("leads_bot_created_idx").on(t.tenantId, t.botId, t.createdAt),
    index("leads_conversation_idx").on(t.tenantId, t.conversationId),
    foreignKey({
      name: "leads_bot_tenant_fk",
      columns: [t.botId, t.tenantId],
      foreignColumns: [bots.id, bots.tenantId],
    }).onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------------------------
// CRM integrations (RLS enforced)
// ---------------------------------------------------------------------------------------------

export const connectionStatuses = ["connected", "error"] as const;
export type ConnectionStatus = (typeof connectionStatuses)[number];

/**
 * An assistant's connection to an outside system (Jobber, ServiceTitan, Housecall Pro, a
 * webhook…; connectors live in @traiblazer/integrations). `credentials` holds the API keys or
 * OAuth tokens, sealed with AES-256-GCM under INTEGRATIONS_SECRET_KEY and bound to this row's
 * tenant, assistant and provider: the database never sees them in the clear, and the API never
 * sends them back to the portal.
 */
export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    /** Connector id, e.g. "jobber". */
    provider: text("provider").notNull(),
    /** "error": the CRM refused the credentials; the owner must connect again. */
    status: text("status").$type<ConnectionStatus>().notNull().default("connected"),
    /** The connected account's name at the CRM, shown to the owner. */
    accountName: text("account_name"),
    /** Sealed JSON (see `seal` in @traiblazer/integrations). */
    credentials: text("credentials").notNull(),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    connectedBy: uuid("connected_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("integration_connections_bot_provider_uq").on(t.botId, t.provider),
    index("integration_connections_tenant_bot_idx").on(t.tenantId, t.botId),
    foreignKey({
      name: "integration_connections_bot_tenant_fk",
      columns: [t.botId, t.tenantId],
      foreignColumns: [bots.id, bots.tenantId],
    }).onDelete("cascade"),
  ],
);

export const leadSyncStatuses = ["sent", "failed"] as const;
export type LeadSyncStatus = (typeof leadSyncStatuses)[number];

/**
 * Where a request stands with each connected CRM: sent (with the CRM's id and link) or failed
 * (with the reason, shown to staff, who can send it again). One row per request and provider, so
 * a retried job never creates the same record twice.
 */
export const leadSyncs = pgTable(
  "lead_syncs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status").$type<LeadSyncStatus>().notNull(),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    error: text("error"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("lead_syncs_lead_provider_uq").on(t.leadId, t.provider),
    index("lead_syncs_tenant_bot_idx").on(t.tenantId, t.botId),
    foreignKey({
      name: "lead_syncs_bot_tenant_fk",
      columns: [t.botId, t.tenantId],
      foreignColumns: [bots.id, bots.tenantId],
    }).onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------------------------
// Knowledge gaps (RLS enforced)
// ---------------------------------------------------------------------------------------------

export const gapStatuses = ["open", "answered", "dismissed"] as const;
export type GapStatus = (typeof gapStatuses)[number];

/**
 * Something visitors asked that the assistant couldn't answer from the business's information.
 * Similar questions are counted on one row, so the business sees what is asked most and can add
 * the answer (which becomes a Q&A pair) or dismiss it.
 */
export const knowledgeGaps = pgTable(
  "knowledge_gaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    /** What was missing, in a few words, as named by the assistant. */
    topic: text("topic").notNull(),
    /** The most recent visitor question about it, in the visitor's words. */
    question: text("question").notNull(),
    language: text("language"),
    /** Conversation of that question. Not a foreign key (kept if the conversation is removed). */
    conversationId: uuid("conversation_id"),
    status: text("status").$type<GapStatus>().notNull().default("open"),
    /** How many times visitors asked about it. */
    occurrences: integer("occurrences").notNull().default(1),
    /** The Q&A pair that answered it, once answered. Not a foreign key (the pair can be deleted). */
    qaPairId: uuid("qa_pair_id"),
    lastAskedAt: timestamp("last_asked_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index("knowledge_gaps_bot_status_idx").on(t.tenantId, t.botId, t.status, t.lastAskedAt),
    foreignKey({
      name: "knowledge_gaps_bot_tenant_fk",
      columns: [t.botId, t.tenantId],
      foreignColumns: [bots.id, bots.tenantId],
    }).onDelete("cascade"),
  ],
);

/** Reference from a message to an uploaded image; the image data lives in `message_attachments`. */
export interface AttachmentRef {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    language: text("language"),
    citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
    flags: jsonb("flags").$type<MessageFlags>().notNull().default({}),
    /** Images the visitor sent with this message (names and ids only; never the image data). */
    attachments: jsonb("attachments").$type<AttachmentRef[]>().notNull().default([]),
    /** Business photos the assistant showed with this reply. */
    images: jsonb("images").$type<ReplyImage[]>().notNull().default([]),
    provider: text("provider"),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    /** Cost in micro-USD (1e-6 USD). */
    costMicros: bigint("cost_micros", { mode: "number" }),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    index("messages_tenant_created_idx").on(t.tenantId, t.createdAt),
    unique("messages_id_tenant_uq").on(t.id, t.tenantId),
    foreignKey({
      name: "messages_conversation_tenant_fk",
      columns: [t.conversationId, t.tenantId],
      foreignColumns: [conversations.id, conversations.tenantId],
    }).onDelete("cascade"),
  ],
);

/**
 * Images sent by visitors in the chat (RLS enforced). Kept apart from `messages` so the stored
 * transcript stays clean: the message holds an `AttachmentRef`, this row holds the image as base64
 * (validated by content and stripped of metadata before it is stored). Visitor data, never public.
 */
export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    messageId: uuid("message_id").notNull(),
    /** File name as given by the visitor's browser (display only). */
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    dataBase64: text("data_base64").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("message_attachments_message_idx").on(t.messageId),
    index("message_attachments_conversation_idx").on(t.tenantId, t.conversationId),
    foreignKey({
      name: "message_attachments_message_tenant_fk",
      columns: [t.messageId, t.tenantId],
      foreignColumns: [messages.id, messages.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "message_attachments_conversation_tenant_fk",
      columns: [t.conversationId, t.tenantId],
      foreignColumns: [conversations.id, conversations.tenantId],
    }).onDelete("cascade"),
  ],
);

export const setupStatuses = ["pending", "running", "ready", "failed", "applied"] as const;
export type SetupStatus = (typeof setupStatuses)[number];

/**
 * What the setup assistant proposes for a business after reading its information. Nothing here is
 * in use until the owner reviews it and applies it.
 */
/** A service or product the setup assistant found in the business's information. */
export interface SetupService {
  kind: CatalogKind;
  /** As the business writes it. */
  name: string;
  description?: string;
  /** The price in the business's own words ("from $120"); left out when its information gives none. */
  priceText?: string;
  category?: string;
}

export interface SetupSuggestion {
  /** Business details found in the information. A detail that wasn't found is left out. */
  profile: {
    businessName?: string;
    phone?: string;
    email?: string;
    websiteUrl?: string;
    address?: string;
    hours?: WeeklyHours;
    /** One or two sentences for the top of the business page. */
    description?: string;
  };
  /**
   * Services and products for the business page that aren't on it yet. Absent on suggestions
   * written before the setup assistant proposed them.
   */
  services?: SetupService[];
  /** The business's own words that the hours and the address were read from. */
  evidence: { hours?: string; address?: string };
  /** A welcome message per language code. */
  greeting: Record<string, string>;
  /** Suggested first questions per language code, each answered by the information. */
  quickReplies: Record<string, string[]>;
  /** Questions customers often ask that the information doesn't answer. */
  missing: string[];
  /** How many pages were read, out of how many the assistant has. */
  pagesRead: number;
  pagesTotal: number;
  /** True when no AI model was available: only contact details were looked up. */
  basic?: boolean;
}

/**
 * A run of the setup assistant for one assistant: it reads the business's information in the
 * background and stores a suggestion for the owner to review (see `runSetup` in @traiblazer/core).
 */
export const setupRuns = pgTable(
  "setup_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull(),
    status: text("status").$type<SetupStatus>().notNull().default("pending"),
    suggestion: jsonb("suggestion").$type<SetupSuggestion>(),
    /** Why it failed, in words the owner can read. */
    error: text("error"),
    /** The model that wrote the suggestion, and what the run cost. */
    model: text("model"),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    /** The user who started it. Not a foreign key (kept if the user leaves). */
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (t) => [
    index("setup_runs_bot_created_idx").on(t.tenantId, t.botId, t.createdAt),
    foreignKey({
      name: "setup_runs_bot_tenant_fk",
      columns: [t.botId, t.tenantId],
      foreignColumns: [bots.id, bots.tenantId],
    }).onDelete("cascade"),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id"),
    /** e.g. "llm.chat", "llm.aux", "embedding", "crawl.page" */
    kind: text("kind").notNull(),
    quantity: integer("quantity").notNull().default(1),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_events_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

/**
 * Monthly question counter per business, used to enforce quotas atomically (one row per month,
 * period "YYYY-MM" in the platform's reporting time zone) and to report refused questions.
 */
export const usageCounters = pgTable(
  "usage_counters",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    questions: integer("questions").notNull().default(0),
    /** Refused because the monthly limit was reached. */
    blockedQuota: integer("blocked_quota").notNull().default(0),
    /** Refused because too many questions at once / per minute for this business (busy). */
    blockedBusy: integer("blocked_busy").notNull().default(0),
    /** Refused by per-visitor or per-conversation limits (abuse protection). */
    blockedVisitor: integer("blocked_visitor").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "usage_counters_pk", columns: [t.tenantId, t.period] })],
);

// ---------------------------------------------------------------------------------------------
// Background jobs (platform table, no RLS — workers switch into the job's tenant via withTenant)
// ---------------------------------------------------------------------------------------------

export const jobStatuses = ["queued", "running", "done", "failed"] as const;
export type JobStatus = (typeof jobStatuses)[number];

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    /** Higher runs first (urgent request alerts jump ahead of website crawls). */
    priority: integer("priority").notNull().default(0),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [index("jobs_ready_idx").on(t.status, t.runAt)],
);

// ---------------------------------------------------------------------------------------------
// Assets (RLS enforced) — small public images such as assistant avatars.
// Stored in Postgres for now; behind an interface so they can move to object storage (S3/R2).
// ---------------------------------------------------------------------------------------------

/**
 * avatar: assistant picture; knowledge_image: business photo the assistant can show visitors;
 * catalog_image: photo of a service or product on the business page.
 */
export const assetKinds = ["avatar", "knowledge_image", "catalog_image"] as const;
export type AssetKind = (typeof assetKinds)[number];

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").$type<AssetKind>().notNull(),
    contentType: text("content_type").notNull(),
    bytes: bytea("bytes").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assets_tenant_idx").on(t.tenantId)],
);

/** Tables protected by row-level security. Keep in sync with migrations. */
export const rlsTables = [
  "usage_counters",
  "assets",
  "bots",
  "bot_keys",
  "business_profiles",
  "bot_addons",
  "audit_logs",
  "knowledge_sources",
  "source_files",
  "documents",
  "chunks",
  "qa_pairs",
  "knowledge_images",
  "catalog_items",
  "notices",
  "page_stats",
  "conversations",
  "messages",
  "message_attachments",
  "leads",
  "integration_connections",
  "lead_syncs",
  "knowledge_gaps",
  "setup_runs",
  "usage_events",
] as const;
