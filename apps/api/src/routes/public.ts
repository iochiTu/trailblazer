import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  AVATAR_ICONS,
  type AvatarIcon,
  DEFAULT_COLOR,
  DEFAULT_THEME,
  initialsOf,
  isHexColor,
  isTheme,
  type PublicAppearance,
  type PublicAvatar,
} from "@traiblazer/appearance";
import { type ChatImage, runChat } from "@traiblazer/core";
import {
  type BotSettings,
  bots,
  businessProfiles,
  conversations,
  messages,
  type ReplyImage,
  resolveBotKey,
  tenants,
  withTenant,
} from "@traiblazer/db";
import { getLanguage } from "@traiblazer/i18n";
import { getTemplate } from "@traiblazer/industry-packs";
import { MAX_CHAT_IMAGE_BYTES, MAX_CHAT_IMAGES, publicChatSchema } from "@traiblazer/shared";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppContext } from "../context.js";
import { admitImages, admitQuestion, type RefusalReason } from "../lib/chat-guard.js";
import { HttpError, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { prepareChatImage } from "../lib/images.js";
import { publicAssetUrl } from "./assets.js";

/** English fallback text; the chat page shows its own translated message for each code. */
const REFUSAL_MESSAGES: Record<RefusalReason, string> = {
  quota: "This assistant has reached its question limit for this month.",
  busy: "Lots of people are asking questions right now. Please try again in a moment.",
  visitor: "You've reached today's question limit for this assistant.",
  conversation: "This conversation is very long. Please start a new conversation.",
};

const IMAGE_ERRORS = {
  type: "Please send a PNG, JPEG or WebP image",
  size: `Images must be smaller than ${MAX_CHAT_IMAGE_BYTES / 1024 / 1024} MB`,
} as const;

/** Display name only: no paths or control characters. */
const cleanFileName = (name: string) =>
  (name.split(/[\\/]/).pop() ?? "")
    .replace(/[\p{Cc}<>]/gu, "")
    .trim()
    .slice(0, 120) || "image";

const KEY_RE = /^pk_(live|test)_[A-Za-z0-9_-]{10,64}$/;

/** Resolves stored settings into what the chat page and widget need (defaults applied). */
export function toPublicAppearance(
  settings: BotSettings,
  businessName: string,
  publicUrl: string,
): PublicAppearance {
  const assistantName = settings.assistantName?.trim() || businessName;
  const stored = settings.avatar;
  const avatar: PublicAvatar =
    stored?.kind === "image"
      ? { kind: "image", url: publicAssetUrl(publicUrl, stored.assetId) }
      : stored?.kind === "icon" && stored.icon in AVATAR_ICONS
        ? { kind: "icon", icon: stored.icon as AvatarIcon }
        : { kind: "initials", initials: initialsOf(assistantName) };
  return {
    theme: isTheme(settings.theme) ? settings.theme : DEFAULT_THEME,
    color: settings.color && isHexColor(settings.color) ? settings.color : DEFAULT_COLOR,
    assistantName,
    avatar,
    launcherLabel: settings.launcherLabel?.trim() || null,
    launcherPosition: settings.launcherPosition === "left" ? "left" : "right",
  };
}

const ASSET_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

/** Shown when a link/QR code points to a chat that is paused, unknown, or whose web version is off. */
const UNAVAILABLE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Chat unavailable</title><style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;color:#555;text-align:center}</style></head><body><div><p>This chat isn't available right now.</p><p lang="fr">Ce clavardage n'est pas disponible pour le moment.</p></div></body></html>`;

/**
 * Public, unauthenticated surface used by visitors:
 *   GET  /c/:key                     chat page (hosted link, iframe, widget panel)
 *   GET  /widget.js                  floating-widget loader for customer websites
 *   GET  /chat-assets/assets/:file   chat page assets
 *   GET  /v1/public/bots/:key        chat configuration (branding, languages, greeting)
 *   POST /v1/public/chat             send a message (optionally with images); the answer streams
 *                                    back as server-sent events
 *   GET  /v1/public/conversations/:id?key&visitorId   restore a visitor's conversation
 */
export async function publicRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, config } = ctx;
  const publicOrigin = new URL(config.PUBLIC_URL).origin;
  const adminOrigin = new URL(config.ADMIN_ORIGIN).origin;
  const distDir = ctx.chatDistDir;

  async function loadBot(publicKey: string) {
    if (!KEY_RE.test(publicKey)) return null;
    const resolved = await resolveBotKey(db, publicKey);
    if (!resolved) return null;
    // A business suspended by operators is invisible to visitors (page, widget and chat).
    const [tenant] = await db
      .select({ status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, resolved.tenantId))
      .limit(1);
    if (tenant?.status !== "active") return null;
    return withTenant(db, resolved.tenantId, async (tx) => {
      const [bot] = await tx.select().from(bots).where(eq(bots.id, resolved.botId)).limit(1);
      if (!bot) return null;
      const [profile] = await tx
        .select()
        .from(businessProfiles)
        .where(eq(businessProfiles.botId, bot.id))
        .limit(1);
      return { ...resolved, bot, profile: profile ?? null };
    });
  }

  // ---- Chat page ----------------------------------------------------------------------------

  app.get<{ Params: { key: string } }>("/c/:key", async (request, reply) => {
    const found = await loadBot(request.params.key);
    reply.header("cache-control", "no-store").header("referrer-policy", "strict-origin-when-cross-origin");
    if (!found || found.bot.status === "paused") {
      return reply.code(404).type("text/html; charset=utf-8").send(UNAVAILABLE_PAGE);
    }

    // Top-level visits (the shareable link) can be switched off; iframes on allowed sites still work.
    const dest = request.headers["sec-fetch-dest"];
    if (dest === "document" && !found.bot.hostedPageEnabled) {
      return reply.code(404).type("text/html; charset=utf-8").send(UNAVAILABLE_PAGE);
    }

    if (!distDir) throw new HttpError(503, "unavailable", "Chat page is not built");
    const html = await readFile(path.join(distDir, "index.html"), "utf8").catch(() => null);
    if (!html) throw new HttpError(503, "unavailable", "Chat page is not built (run pnpm build)");

    const ancestors = ["'self'", adminOrigin, ...found.allowedOrigins].join(" ");
    reply.header(
      "content-security-policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
        `frame-ancestors ${ancestors}`,
      ].join("; "),
    );
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/widget.js", async (_request, reply) => {
    if (!distDir) throw notFound("Widget");
    const js = await readFile(path.join(distDir, "widget.js"), "utf8").catch(() => null);
    if (!js) throw notFound("Widget");
    return reply
      .type("text/javascript; charset=utf-8")
      .header("cache-control", "public, max-age=300")
      .header("cross-origin-resource-policy", "cross-origin")
      .header("access-control-allow-origin", "*")
      .send(js);
  });

  app.get<{ Params: { file: string } }>("/chat-assets/assets/:file", async (request, reply) => {
    const { file } = request.params;
    const type = ASSET_TYPES[path.extname(file)];
    if (!distDir || !/^[A-Za-z0-9._-]+$/.test(file) || !type) throw notFound("Asset");
    const body = await readFile(path.join(distDir, "assets", file)).catch(() => null);
    if (!body) throw notFound("Asset");
    return reply.type(type).header("cache-control", "public, max-age=31536000, immutable").send(body);
  });

  // ---- Chat API -----------------------------------------------------------------------------

  app.get<{ Params: { key: string } }>("/v1/public/bots/:key", async (request, reply) => {
    const found = await loadBot(request.params.key);
    if (!found || found.bot.status === "paused") throw notFound("Assistant");
    const { bot, profile } = found;
    const settings: BotSettings = bot.settings ?? {};
    const template = getTemplate(bot.pack, bot.variant);
    const businessName = profile?.businessName ?? bot.name;
    // Public, non-sensitive data; the widget loader reads it from the customer's website.
    reply.header("access-control-allow-origin", "*");
    return {
      bot: {
        name: bot.name,
        businessName,
        appearance: toPublicAppearance(settings, businessName, config.PUBLIC_URL),
        // Public business contact, shown when the assistant can't answer (e.g. monthly limit reached).
        contact: { phone: profile?.phone ?? null, email: profile?.email ?? null },
        defaultLanguage: bot.defaultLanguage,
        languages: bot.languages.map((code) => {
          const lang = getLanguage(code);
          return { code, nativeName: lang?.nativeName ?? code, dir: lang?.dir ?? "ltr" };
        }),
        greeting: settings.greeting ?? {},
        quickReplies: { ...template.quickReplies, ...(settings.quickReplies ?? {}) },
        poweredBy: true,
      },
    };
  });

  const toPublicImage = (image: ReplyImage) => ({
    url: publicAssetUrl(config.PUBLIC_URL, image.assetId),
    alt: image.title,
  });

  const assertSameOrigin = (origin: string | undefined) => {
    // The chat page and this API share an origin; browsers always send Origin on POST.
    if (origin && origin !== publicOrigin)
      throw new HttpError(403, "forbidden_origin", "Cross-origin requests are not allowed");
  };

  app.post(
    "/v1/public/chat",
    {
      config: {
        rateLimit: {
          // Operator policy (operator console), unless overridden by CHAT_RATE_LIMIT_PER_MIN.
          max: async () => config.CHAT_RATE_LIMIT_PER_MIN ?? (await ctx.platform!.policies()).chatIpPerMinute,
          timeWindow: "1 minute",
        },
      },
      // Room for the allowed images as base64 plus the message.
      bodyLimit: Math.ceil((MAX_CHAT_IMAGES * MAX_CHAT_IMAGE_BYTES * 4) / 3) + 64 * 1024,
    },
    async (request, reply: FastifyReply) => {
      assertSameOrigin(request.headers.origin);
      const input = publicChatSchema.parse(request.body);

      // Images are checked by their content (never the name), and their metadata is removed.
      const images: ChatImage[] = [];
      for (const image of input.images) {
        const prepared = prepareChatImage(image.data, MAX_CHAT_IMAGE_BYTES);
        if (!prepared.ok) {
          return reply
            .code(400)
            .send({ error: `image_${prepared.reason}`, message: IMAGE_ERRORS[prepared.reason] });
        }
        images.push({
          name: cleanFileName(image.name),
          contentType: prepared.contentType,
          dataBase64: prepared.bytes.toString("base64"),
          sizeBytes: prepared.bytes.length,
          sha256: createHash("sha256").update(prepared.bytes).digest("hex"),
        });
      }

      const found = await loadBot(input.publicKey);
      if (!found || found.bot.status === "paused") throw notFound("Assistant");

      if (
        images.length &&
        !(await admitImages(ctx.limiter!, {
          tenantId: found.tenantId,
          visitorId: input.visitorId,
          count: images.length,
        }))
      ) {
        return reply
          .code(429)
          .header("retry-after", "3600")
          .send({ error: "images", message: "Too many images. Please wait a while before sending more." });
      }

      // Abuse, noisy-neighbour and monthly limits, before any AI cost is incurred.
      const admission = await admitQuestion(
        {
          db,
          limiter: ctx.limiter!,
          platform: ctx.platform!,
          maxConversationQuestions: config.CONVERSATION_MAX_QUESTIONS,
        },
        {
          tenantId: found.tenantId,
          visitorId: input.visitorId,
          conversationId: input.conversationId ?? null,
        },
      );
      if (!admission.ok) {
        return reply
          .code(429)
          .header("retry-after", admission.reason === "busy" ? "30" : "3600")
          .send({ error: admission.reason, message: REFUSAL_MESSAGES[admission.reason] });
      }

      const controller = new AbortController();
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
        connection: "keep-alive",
      });
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });

      try {
        for await (const event of runChat(
          {
            db,
            gateway: ctx.gateway,
            embeddings: ctx.embeddings,
            log: (msg, data) => request.log.error(data, msg),
          },
          {
            tenantId: found.tenantId,
            botId: found.botId,
            conversationId: input.conversationId ?? null,
            visitorId: input.visitorId,
            channel: input.channel,
            message: input.message,
            images,
            pageUrl: input.pageUrl ?? null,
            signal: controller.signal,
          },
        )) {
          if (controller.signal.aborted) break;
          // Business photos go to the chat as public URLs with the owner's title as alt text.
          const out = event.type === "image" ? { type: "image", image: toPublicImage(event.image) } : event;
          res.write(`data: ${JSON.stringify(out)}\n\n`);
        }
      } catch (error) {
        request.log.error(error, "chat stream failed");
        if (!res.writableEnded) {
          res.write(
            `data: ${JSON.stringify({ type: "error", code: "failed", message: "Something went wrong" })}\n\n`,
          );
        }
      } finally {
        res.end();
        await admission.release();
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { key?: string; visitorId?: string } }>(
    "/v1/public/conversations/:id",
    async (request) => {
      const { id } = request.params;
      const { key = "", visitorId = "" } = request.query;
      if (!isUuid(id) || !visitorId) throw notFound("Conversation");
      const found = await loadBot(key);
      if (!found) throw notFound("Conversation");
      const rows = await withTenant(db, found.tenantId, async (tx) => {
        const [conversation] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.id, id),
              eq(conversations.botId, found.botId),
              eq(conversations.visitorId, visitorId),
            ),
          )
          .limit(1);
        if (!conversation) return null;
        return tx
          .select({
            role: messages.role,
            content: messages.content,
            citations: messages.citations,
            // Names only: the visitor's transcript shows a file chip, never the image itself.
            attachments: messages.attachments,
            images: messages.images,
          })
          .from(messages)
          .where(eq(messages.conversationId, id))
          .orderBy(asc(messages.createdAt))
          .limit(100);
      });
      if (!rows) throw notFound("Conversation");
      return { messages: rows.map((m) => ({ ...m, images: m.images.map(toPublicImage) })) };
    },
  );
}
