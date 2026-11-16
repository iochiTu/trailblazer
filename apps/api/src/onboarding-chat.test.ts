import {
  createDb,
  type DbHandle,
  onboardingQuestions,
  operatorAuditLogs,
  runMigrations,
  tenants,
  usageEvents,
  users,
} from "@traiblazer/db";
import { STANDARD_QUESTIONS } from "@traiblazer/industry-packs";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { and, eq, inArray, like } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { toEntry } from "./lib/interview-questions.js";
import { industryPrompt, parseIndustry } from "./routes/onboarding-chat.js";
import { newTenant, newUser } from "./test-helpers.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;

let app: FastifyInstance;
let appDb: DbHandle;
let ownerDb: DbHandle;
let staff: string;
let owner: string;
let tenantId: string;
let botId: string;
const emails: string[] = [];
const tenantIds: string[] = [];
const { gateway } = createGatewayFromEnv({});

const base = "/v1/operator/onboarding-questions";
const call = (
  method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE",
  url: string,
  cookie: string,
  payload?: unknown,
) => app.inject({ method, url, headers: { cookie }, payload: payload as object | undefined });
const interviewKeys = async () =>
  (await call("GET", `/v1/tenants/${tenantId}/bots/${botId}/interview`, owner))
    .json()
    .questions.map((q: { key: string }) => q.key) as string[];

/** Puts the set back to the standard one (the migration's seed), for the other tests. */
async function resetSet() {
  await ownerDb.db.delete(onboardingQuestions);
  await ownerDb.db.insert(onboardingQuestions).values(
    STANDARD_QUESTIONS.map(({ key, packs, kind, question, hint, options, sortOrder }) => ({
      key,
      packs,
      kind,
      question,
      hint,
      options,
      sortOrder,
    })),
  );
}

beforeAll(async () => {
  await runMigrations(ownerUrl);
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  const config = loadConfig({
    NODE_ENV: "test",
    AUTH_RATE_LIMIT_PER_MIN: "1000",
    CHAT_RATE_LIMIT_PER_MIN: "1000",
    PUBLIC_URL: "http://chat.test.local",
    ADMIN_ORIGIN: "http://admin.test.local",
  } as NodeJS.ProcessEnv);
  app = await buildApp({ db: appDb.db, config, gateway });
  await resetSet();

  staff = await newUser(app, emails, "questions-staff");
  await ownerDb.db
    .update(users)
    .set({ platformRole: "super_admin" })
    .where(eq(users.email, emails.at(-1)!));
  owner = await newUser(app, emails, "questions-owner");
  tenantId = await newTenant(app, tenantIds, owner, "Lakeview Inn");
  botId = (
    await call("POST", `/v1/tenants/${tenantId}/bots`, owner, { name: "Lakeview Inn", pack: "lodging" })
  ).json().bot.id;
});

afterAll(async () => {
  if (ownerDb) await resetSet();
  if (tenantIds.length) await ownerDb?.db.delete(tenants).where(inArray(tenants.id, tenantIds));
  if (emails.length) await ownerDb?.db.delete(users).where(inArray(users.email, emails));
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("standard question set", () => {
  it("is what the migration seeds", async () => {
    const rows = await ownerDb.db.select().from(onboardingQuestions);
    const seeded = rows.map(toEntry).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(seeded).toEqual(STANDARD_QUESTIONS);
  });

  it("is what a business is asked for its industry", async () => {
    expect(await interviewKeys()).toEqual([
      "about",
      "services",
      "where",
      "hours",
      "contact",
      "payment",
      "visit",
      "cancellation",
      "checkin",
      "amenities",
      "pets",
      "faq",
    ]);
  });
});

describe("editing the question set (operator console)", () => {
  let id: string;

  it("is for staff only", async () => {
    expect((await call("GET", base, owner)).statusCode).toBe(404);
    expect((await call("POST", base, owner, {})).statusCode).toBe(404);
    const list = await call("GET", base, staff);
    expect(list.statusCode).toBe(200);
    expect(list.json().questions).toHaveLength(STANDARD_QUESTIONS.length);
    expect(list.json().questions[0]).toMatchObject({ key: "about", standard: true, modified: false });
    expect(list.json().packs.map((p: { slug: string }) => p.slug)).toContain("lodging");
  });

  it("adds a question for some industries, asked after the others", async () => {
    const created = await call("POST", base, staff, {
      key: "shuttle",
      packs: ["lodging"],
      kind: "choice",
      question: { en: "Do you offer an airport shuttle?", fr: "Offrez-vous une navette vers l'aéroport?" },
      hint: { en: "", fr: "" },
      options: [
        { en: "Yes, free", fr: "Oui, gratuite" },
        { en: "No", fr: "Non" },
      ],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().question).toMatchObject({ key: "shuttle", sortOrder: 910, standard: false });
    id = created.json().question.id;
    expect((await interviewKeys()).at(-1)).toBe("shuttle");
    const [question] = (await call("GET", `/v1/tenants/${tenantId}/bots/${botId}/interview`, owner))
      .json()
      .questions.filter((q: { key: string }) => q.key === "shuttle");
    expect(question).toMatchObject({ kind: "choice", options: [{ en: "Yes, free" }, { en: "No" }] });

    const duplicate = await call("POST", base, staff, {
      key: "shuttle",
      kind: "short",
      question: { en: "Again?", fr: "Encore?" },
      hint: { en: "", fr: "" },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("refuses a question that isn't complete in both languages or doesn't fit its kind", async () => {
    const make = (body: object) =>
      call("POST", base, staff, {
        key: "draft",
        kind: "short",
        question: { en: "Question?", fr: "Question?" },
        hint: { en: "", fr: "" },
        ...body,
      });
    expect((await make({ question: { en: "Only English", fr: "" } })).json().message).toMatch(
      /English and French/,
    );
    expect((await make({ hint: { en: "Hint", fr: "" } })).json().message).toMatch(/both languages/);
    expect((await make({ kind: "choice", options: [{ en: "One", fr: "Un" }] })).json().message).toMatch(
      /two quick answers/,
    );
    expect((await make({ options: [{ en: "A", fr: "A" }] })).json().message).toMatch(/Only choice/);
    expect((await make({ packs: ["spaceships"] })).json().message).toMatch(/Unknown industry/);
    expect((await make({ key: "Bad Key" })).statusCode).toBe(400);
  });

  it("changes, turns off and resets a standard question; the key stays", async () => {
    const pets = (await call("GET", base, staff))
      .json()
      .questions.find((q: { key: string }) => q.key === "pets");
    const changed = await call("PATCH", `${base}/${pets.id}`, staff, {
      kind: "short",
      hint: {
        en: "e.g. “Dogs under 20 kg, $25 a night”.",
        fr: "p. ex. « Chiens de moins de 20 kg, 25 $ la nuit ».",
      },
      key: "renamed",
    });
    expect(changed.statusCode).toBe(200);
    // Quick answers go with the kind; the key can't be changed.
    expect(changed.json().question).toMatchObject({
      key: "pets",
      kind: "short",
      options: [],
      modified: true,
    });

    await call("PATCH", `${base}/${pets.id}`, staff, { enabled: false });
    expect(await interviewKeys()).not.toContain("pets");

    const reset = await call("POST", `${base}/${pets.id}/reset`, staff);
    expect(reset.json().question).toMatchObject({ kind: "choice", modified: false, enabled: false });
    expect((await call("POST", `${base}/${id}/reset`, staff)).statusCode).toBe(400);
    await call("PATCH", `${base}/${pets.id}`, staff, { enabled: true });
    expect(await interviewKeys()).toContain("pets");
  });

  it("reorders the whole set", async () => {
    const ids = (await call("GET", base, staff)).json().questions.map((q: { id: string }) => q.id);
    expect((await call("POST", `${base}/order`, staff, { ids: ids.slice(1) })).statusCode).toBe(400);
    const moved = [id, ...ids.filter((x: string) => x !== id)];
    const res = await call("POST", `${base}/order`, staff, { ids: moved });
    expect(res.json().questions[0]).toMatchObject({ key: "shuttle", sortOrder: 10 });
    expect((await interviewKeys())[0]).toBe("shuttle");
  });

  it("removes a question, and adds removed standard ones back", async () => {
    const about = (await call("GET", base, staff))
      .json()
      .questions.find((q: { key: string }) => q.key === "about");
    expect((await call("DELETE", `${base}/${about.id}`, staff)).statusCode).toBe(204);
    expect(await interviewKeys()).not.toContain("about");
    const restored = await call("POST", `${base}/restore`, staff);
    expect(restored.json().restored).toEqual(["about"]);
    expect(await interviewKeys()).toContain("about");
  });

  it("writes every change to the operator audit log", async () => {
    const actions = (
      await ownerDb.db
        .select({ action: operatorAuditLogs.action })
        .from(operatorAuditLogs)
        .where(like(operatorAuditLogs.action, "onboarding_question.%"))
    ).map((r) => r.action);
    for (const action of ["created", "updated", "reset", "reordered", "deleted", "restored"]) {
      expect(actions).toContain(`onboarding_question.${action}`);
    }
  });
});

describe("onboarding chat: industry from a description", () => {
  const industry = (description: string, cookie = owner) =>
    call("POST", `/v1/tenants/${tenantId}/onboarding/industry`, cookie, { description });

  it("recognizes the industry from the owner's words", async () => {
    const res = await industry("Petite boulangerie artisanale");
    expect(res.json()).toEqual({ pack: "cafe-bakery", variant: "bakery", from: "words" });
  });

  it("asks the model when the words don't say, and records what it cost", async () => {
    // The offline model only echoes the description: nothing it says is an industry.
    const res = await industry("We help people with their paperwork");
    expect(res.json()).toEqual({ pack: null, variant: null, from: "none" });
    const used = await ownerDb.db
      .select()
      .from(usageEvents)
      .where(and(eq(usageEvents.tenantId, tenantId), eq(usageEvents.kind, "llm.aux")));
    expect(used.map((u) => u.metadata.task)).toContain("onboarding_industry");
  });

  it("is for the business's own editors", async () => {
    const stranger = await newUser(app, emails, "questions-stranger");
    expect((await industry("Bakery", stranger)).statusCode).toBe(404);
    expect((await industry("")).statusCode).toBe(400);
  });

  it("keeps only an industry that can be chosen from the model's reply", () => {
    expect(parseIndustry('{"pack": "lodging", "variant": null}', 1)).toEqual({
      pack: "lodging",
      variant: null,
    });
    expect(parseIndustry('Sure! {"pack":"trades","variant":"hvac"}', 1)).toEqual({
      pack: "trades",
      variant: "hvac",
    });
    expect(parseIndustry('{"pack":"trades","variant":"bakery"}', 1)).toEqual({
      pack: "trades",
      variant: null,
    });
    expect(parseIndustry('{"pack":"law-firm"}', 1)).toBeNull();
    expect(parseIndustry("not json", 1)).toBeNull();
    expect(industryPrompt([])).toMatch(/JSON only/);
  });
});
