import type { bots } from "@traiblazer/db";
import { describe, expect, it } from "vitest";
import { buildSystemBlocks } from "./prompt.js";

type Bot = typeof bots.$inferSelect;

const bot = (overrides: Partial<Bot>): Bot =>
  ({
    id: "b",
    tenantId: "t",
    name: "Pine Café",
    pack: "cafe-bakery",
    variant: null,
    persona: null,
    languages: ["en", "fr", "uk"],
    defaultLanguage: "en",
    settings: {},
    ...overrides,
  }) as Bot;

const botBlock = (b: Bot) =>
  buildSystemBlocks({ bot: b, profile: null, passages: [], now: new Date() })[1]!.text;

describe("language rules in the prompt", () => {
  it("lists the languages offered and answers other languages by default", () => {
    const text = botBlock(bot({}));
    expect(text).toContain("<languages>\nLanguages offered: English, French, Ukrainian.");
    expect(text).toContain("If the visitor's language is unclear, use English.");
    expect(text).not.toContain("Only reply in one of the languages offered");
  });

  it("limits replies to the languages offered when the owner turns other languages off", () => {
    const text = botBlock(bot({ defaultLanguage: "fr", settings: { answerOtherLanguages: false } }));
    expect(text).toContain("Only reply in one of the languages offered");
    expect(text).toContain("reply in French");
  });
});

describe("response guidelines and workflows in the prompt", () => {
  const workflow = {
    id: "cake",
    name: "Custom cake",
    enabled: true,
    when: "The visitor wants a custom cake.",
    steps: ["Ask for the date.", "Ask how many guests."],
    finish: "Share the phone number.",
  };

  it("follows the industry template for assistants without their own copy", () => {
    const text = botBlock(bot({ guidelines: null, workflows: null }));
    expect(text).toContain("<response_guidelines>\nYou help customers of a café or bakery");
    expect(text).toContain("## Custom cake or catering order");
  });

  it("uses the business's own guidelines and enabled workflows", () => {
    const text = botBlock(
      bot({
        guidelines: "Be cheerful.",
        workflows: [workflow, { ...workflow, id: "off", name: "Turned off", enabled: false }],
      }),
    );
    expect(text).toContain("<response_guidelines>\nBe cheerful.\n</response_guidelines>");
    expect(text).toContain(
      "## Custom cake\nWhen: The visitor wants a custom cake.\nSteps:\n1. Ask for the date.\n2. Ask how many guests.\nFinish: Share the phone number.",
    );
    expect(text).not.toContain("Turned off");
    expect(text).not.toContain("café or bakery");
  });

  it("leaves out empty guidelines and workflows", () => {
    const text = botBlock(bot({ guidelines: "", workflows: [] }));
    expect(text).not.toContain("<response_guidelines>");
    expect(text).not.toContain("<workflows>");
  });
});

describe("add-ons in the prompt", () => {
  it("adds the add-ons' text as business information, and nothing when there is none", () => {
    const blocks = (addons: string | null) =>
      buildSystemBlocks({ bot: bot({}), profile: null, passages: [], addons, now: new Date() });
    const text = blocks("## Online shop\nOnline shop: https://shop.example.com")[1]!.text;
    expect(text).toContain("<add_ons>\n## Online shop\nOnline shop: https://shop.example.com\n</add_ons>");
    expect(blocks(null)[1]!.text).not.toContain("<add_ons>");
    expect(blocks(null)[0]!.text).toContain(
      "Answer only from <business_profile>, <add_ons> and <knowledge>.",
    );
  });
});
