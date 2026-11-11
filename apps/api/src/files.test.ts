import { runSetup, syncSource } from "@traiblazer/core";
import {
  createDb,
  type DbHandle,
  jobs,
  knowledgeSources,
  runMigrations,
  sourceFiles,
  tenants,
  users,
} from "@traiblazer/db";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { SOURCE_FILE_LIMIT } from "@traiblazer/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;

let app: FastifyInstance;
let appDb: DbHandle;
let ownerDb: DbHandle;
let cookie: string;
let tenantId: string;
let botId: string;
const emails: string[] = [];
const tenantIds: string[] = [];
// No keys: the offline provider, which can't see images.
const { gateway } = createGatewayFromEnv({});

/** A one-page PDF with a text layer: one line of text per entry. */
function makePdf(lines: string[]): Buffer {
  const content = lines
    .map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 18} Td (${line.replace(/[\\()]/g, "\\$&")}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const priceList = makePdf([
  "Northside Plumbing - Price list",
  "Drain cleaning   from $149",
  "Water heater installation   call for a quote",
  "Call 705-555-0177 or write to office@northsideplumbing.example",
]);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function signup(name: string) {
  const email = `${name}-${crypto.randomUUID().slice(0, 8)}@test.local`;
  emails.push(email);
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email, password: "correct-horse-battery", name },
  });
  return `tb_session=${res.cookies.find((c) => c.name === "tb_session")!.value}`;
}

async function createTenant(sessionCookie: string, name: string) {
  const id = (
    await app.inject({
      method: "POST",
      url: "/v1/tenants",
      headers: { cookie: sessionCookie },
      payload: { name },
    })
  ).json().tenant.id as string;
  tenantIds.push(id);
  return id;
}

const base = () => `/v1/tenants/${tenantId}/bots/${botId}`;
const call = (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
  headers = { cookie },
) => app.inject({ method, url, headers, payload: payload as object | undefined });
const upload = (name: string, bytes: Buffer, extra: object = {}) =>
  call("POST", `${base()}/sources/file`, { name, data: bytes.toString("base64"), ...extra });
const stored = (sourceId: string) =>
  ownerDb.db.select().from(sourceFiles).where(eq(sourceFiles.sourceId, sourceId));

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

  cookie = await signup("files-owner");
  tenantId = await createTenant(cookie, "Northside Plumbing");
  const created = await call("POST", `/v1/tenants/${tenantId}/bots`, {
    name: "Northside Plumbing Assistant",
    pack: "generic",
  });
  botId = created.json().bot.id;
});

afterAll(async () => {
  if (tenantIds.length) await ownerDb?.db.delete(tenants).where(inArray(tenants.id, tenantIds));
  if (emails.length) await ownerDb?.db.delete(users).where(inArray(users.email, emails));
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("uploaded price lists and brochures", () => {
  let sourceId: string;

  it("accepts a PDF, a Word document or a photo by content, whatever the name says", async () => {
    for (const [name, bytes] of [
      ["prices.pdf", Buffer.from("Drain cleaning from $149")],
      ["prices.pdf", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
      // A zip that isn't a Word document.
      ["prices.docx", Buffer.from("504b0304140000000000", "hex")],
    ] as const) {
      const res = await upload(name, bytes);
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/PDF, a Word document/);
    }
    expect((await call("POST", `${base()}/sources/file`, { name: "prices.pdf" })).statusCode).toBe(400);
    expect((await call("GET", `${base()}/sources`)).json().sources).toEqual([]);
  });

  it("stores the file privately and queues it for reading", async () => {
    // Larger than an ordinary request (1 MB): files have their own limit.
    const padded = Buffer.concat([priceList, Buffer.alloc(1_500_000, " ")]);
    const res = await upload("Price list 2026.PDF", padded);
    expect(res.statusCode).toBe(201);
    expect(res.json().source).toMatchObject({
      type: "file",
      title: "Price list 2026",
      fileName: "Price list 2026.PDF",
      status: "pending",
      content: null,
    });
    sourceId = res.json().source.id;

    expect(await stored(sourceId)).toMatchObject([
      { tenantId, contentType: "application/pdf", sizeBytes: padded.length },
    ]);
    const queued = await ownerDb.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.type, "source.sync")));
    expect(queued.map((job) => job.payload)).toEqual([{ sourceId }]);
    expect((await call("GET", `${base()}/sources`)).json().sources).toMatchObject([
      { id: sourceId, type: "file", fileName: "Price list 2026.PDF", url: null },
    ]);
  });

  it("shows the owner the text that was read, and no longer keeps the file", async () => {
    await syncSource({ db: appDb.db, gateway }, tenantId, sourceId);
    const { source } = (await call("GET", `${base()}/sources/${sourceId}`)).json();
    expect(source).toMatchObject({
      type: "file",
      status: "ready",
      fileName: "Price list 2026.PDF",
      fileType: "application/pdf",
      documentCount: 1,
    });
    expect(source.content).toContain("Drain cleaning from $149");
    expect(await stored(sourceId)).toEqual([]);
    // The text is read from the file, not typed: it isn't edited here.
    expect(
      (await call("PATCH", `${base()}/sources/${sourceId}`, { content: "Drain cleaning $1" })).statusCode,
    ).toBe(400);
  });

  it("is enough to set a business up without a website", async () => {
    expect((await call("GET", `${base()}/setup`)).json()).toEqual({ run: null, pages: 1 });
    const started = await call("POST", `${base()}/setup`);
    expect(started.statusCode).toBe(201);
    await runSetup({ db: appDb.db, gateway }, tenantId, started.json().run.id);
    expect((await call("GET", `${base()}/setup`)).json().run).toMatchObject({
      status: "ready",
      suggestion: {
        profile: { phone: "705-555-0177", email: "office@northsideplumbing.example" },
        pagesRead: 1,
      },
    });
  });

  it("says why a photo can't be read when no model can see images", async () => {
    const res = await upload("menu-board.png", png, { title: "Menu board" });
    expect(res.statusCode).toBe(201);
    const photoId = res.json().source.id as string;
    expect(await stored(photoId)).toMatchObject([{ contentType: "image/png" }]);
    await syncSource({ db: appDb.db, gateway }, tenantId, photoId);
    const { source } = (await call("GET", `${base()}/sources/${photoId}`)).json();
    expect(source).toMatchObject({ title: "Menu board", status: "failed", content: null });
    expect(source.error).toMatch(/needs an AI model that can read images/);

    // Deleting the source removes the stored file with it.
    expect((await call("DELETE", `${base()}/sources/${photoId}`)).statusCode).toBe(204);
    expect(await stored(photoId)).toEqual([]);
  });

  it("limits the files per assistant and keeps other businesses out", async () => {
    await ownerDb.db.insert(knowledgeSources).values(
      Array.from({ length: SOURCE_FILE_LIMIT - 1 }, (_, n) => ({
        tenantId,
        botId,
        type: "file" as const,
        title: `File ${n}`,
      })),
    );
    const full = await upload("one-more.pdf", priceList);
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toBe("file_limit");

    const stranger = await signup("files-stranger");
    await createTenant(stranger, "Other Plumbing");
    const headers = { cookie: stranger };
    expect([403, 404]).toContain(
      (
        await call(
          "POST",
          `${base()}/sources/file`,
          { name: "x.pdf", data: priceList.toString("base64") },
          headers,
        )
      ).statusCode,
    );
    expect([403, 404]).toContain(
      (await call("GET", `${base()}/sources/${sourceId}`, undefined, headers)).statusCode,
    );
  });
});
