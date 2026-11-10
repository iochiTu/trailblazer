import { describe, expect, it } from "vitest";
import {
  type AddonContext,
  type AddonEvent,
  activeAddons,
  addonCatalog,
  addonChatLinks,
  addonEffects,
  addonPrompt,
  addons,
  defineAddon,
  getAddon,
  parseAddonConfig,
} from "./index.js";

const ctx: AddonContext = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  botId: "22222222-2222-2222-2222-222222222222",
  businessName: "Pine Café",
  ownerLanguage: "en",
  adminUrl: "https://admin.example.com",
};

const install = (addonId: string, config: unknown, enabled = true) => ({
  addonId,
  enabled,
  config,
  configVersion: 1,
});

const started: AddonEvent = {
  type: "conversation.started",
  conversationId: "c1",
  channel: "widget",
  language: "en",
  message: "Do you have gluten-free bread?",
  at: new Date(),
};
const unanswered: AddonEvent = {
  type: "question.unanswered",
  conversationId: "c1",
  language: "en",
  question: "Do you cater weddings?",
  answer: "I don't have that information.",
  at: new Date(),
};

describe("registry", () => {
  it("has unique ids and a serializable catalog", () => {
    expect(new Set(addons.map((a) => a.id)).size).toBe(addons.length);
    const catalog = addonCatalog();
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
    expect(catalog.find((a) => a.id === "email-notifications")?.status).toBe("available");
  });

  it("gives every add-on English and French text and fields matching its defaults", () => {
    for (const a of addons) {
      for (const text of [a.name, a.summary, a.description]) {
        expect(text.en.length, a.id).toBeGreaterThan(0);
        expect(text.fr.length, a.id).toBeGreaterThan(0);
      }
      for (const field of a.fields) expect(a.defaults, `${a.id}.${field.key}`).toHaveProperty(field.key);
    }
  });
});

describe("settings", () => {
  it("fills defaults, drops unknown keys and reports invalid fields", () => {
    const addon = getAddon("email-notifications")!;
    const ok = parseAddonConfig(addon, { email: "Owner@Example.com", unanswered: false, extra: 1 });
    expect(ok).toEqual({
      ok: true,
      config: { email: "owner@example.com", newConversation: true, unanswered: false, newRequest: true },
    });
    const bad = parseAddonConfig(addon, { email: "nope" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0]?.path).toBe("email");
  });

  it("only runs installed, enabled, available add-ons with valid settings", () => {
    const active = activeAddons([
      install("online-shop", { url: "https://shop.example.com" }),
      install("email-notifications", { email: "a@b.co" }, false),
      install("online-shop-typo", {}),
      install("catalog-sync", {}),
      install("email-notifications", { email: "broken" }),
    ]);
    expect(active.map((a) => a.addon.id)).toEqual(["online-shop"]);
  });

  it("migrates settings saved by an older version", () => {
    const addon = defineAddon({
      ...getAddon("email-notifications")!,
      version: 2,
      migrate: (config) => ({ email: (config as { to: string }).to }),
    });
    expect(parseAddonConfig(addon, { to: "x@y.co" }, 1)).toMatchObject({
      ok: true,
      config: { email: "x@y.co" },
    });
  });
});

describe("online shop", () => {
  const active = activeAddons([
    install("online-shop", {
      url: "https://shop.example.com",
      platform: "shopify",
      note: "Pickup <b>only</b>",
    }),
  ]);

  it("tells the assistant about the shop", () => {
    const text = addonPrompt(active, ctx)!;
    expect(text).toContain("Online shop (Shopify): https://shop.example.com");
    expect(text).toContain("About the shop: Pickup bonly/b");
  });

  it("adds a Shop button unless turned off", () => {
    expect(addonChatLinks(active, ctx)).toEqual([
      { id: "online-shop", url: "https://shop.example.com", label: null, icon: "shop" },
    ]);
    const hidden = activeAddons([install("online-shop", { url: "https://s.co", showButton: false })]);
    expect(addonChatLinks(hidden, ctx)).toEqual([]);
  });
});

describe("email notifications", () => {
  it("emails the owner a visitor's request with their contact details", () => {
    const request: AddonEvent = {
      type: "request.created",
      leadId: "l1",
      conversationId: "c1",
      kind: "quote",
      name: "Jane Doe",
      email: "jane@example.com",
      phone: null,
      bestTime: "after 5 pm",
      message: "Wedding cake for 80, June 3.",
      language: "en",
      at: new Date(),
    };
    const on = activeAddons([install("email-notifications", { email: "o@e.co" })]);
    const [mail] = addonEffects(on, request, ctx);
    expect(mail?.effect).toMatchObject({ kind: "email", to: ["o@e.co"] });
    expect(mail?.effect.subject).toMatch(/Jane Doe asked for a quote$/);
    expect(mail?.effect.text).toContain("Email: jane@example.com");
    expect(mail?.effect.text).not.toContain("Phone:");
    expect(mail?.effect.text).toContain("Best time: after 5 pm");
    expect(mail?.effect.text).toContain("Request: Wedding cake for 80, June 3.");
    const [fr] = addonEffects(on, request, { ...ctx, ownerLanguage: "fr" });
    expect(fr?.effect.subject).toMatch(/Jane Doe demande une soumission$/);

    const off = activeAddons([install("email-notifications", { email: "o@e.co", newRequest: false })]);
    expect(addonEffects(off, request, ctx)).toEqual([]);
  });

  it("emails on new conversations and unanswered questions, as configured", () => {
    const all = activeAddons([install("email-notifications", { email: "owner@example.com" })]);
    const [first] = addonEffects(all, started, ctx);
    expect(first?.addonId).toBe("email-notifications");
    expect(first?.effect).toMatchObject({ kind: "email", to: ["owner@example.com"] });
    expect(first?.effect.subject).toBe('New chat on Pine Café: "Do you have gluten-free bread?"');
    expect(first?.effect.text).toContain(
      `https://admin.example.com/t/${ctx.tenantId}/bots/${ctx.botId}?tab=conversations`,
    );
    expect(addonEffects(all, unanswered, ctx)[0]?.effect.text).toContain("Visitor: Do you cater weddings?");

    const quiet = activeAddons([
      install("email-notifications", { email: "o@e.co", newConversation: false, unanswered: false }),
    ]);
    expect(addonEffects(quiet, started, ctx)).toEqual([]);
    expect(addonEffects(quiet, unanswered, ctx)).toEqual([]);
  });

  it("writes in the owner's language", () => {
    const all = activeAddons([install("email-notifications", { email: "o@e.co" })]);
    const [fr] = addonEffects(all, unanswered, { ...ctx, ownerLanguage: "fr" });
    expect(fr?.effect.subject).toBe("Pine Café : une question restée sans réponse");
  });
});

describe("isolation", () => {
  it("skips an add-on whose hook throws and keeps the others", () => {
    const broken = defineAddon({
      ...getAddon("online-shop")!,
      id: "broken",
      prompt: () => {
        throw new Error("boom");
      },
    });
    const logs: string[] = [];
    const text = addonPrompt(
      [
        { addon: broken, config: {} },
        ...activeAddons([install("online-shop", { url: "https://shop.example.com" })]),
      ],
      ctx,
      (msg, data) => logs.push(`${msg} ${data?.addonId}`),
    );
    expect(text).toContain("https://shop.example.com");
    expect(logs).toEqual(["add-on hook failed broken"]);
  });
});
