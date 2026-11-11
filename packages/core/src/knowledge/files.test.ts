import { crc32 } from "node:zlib";
import {
  bots,
  chunks,
  createDb,
  type DbHandle,
  documents,
  knowledgeSources,
  runMigrations,
  type SourceFileType,
  sourceFiles,
  tenants,
  usageEvents,
  withTenant,
} from "@traiblazer/db";
import {
  type ChatEvent,
  type ChatRequest,
  LLMGateway,
  type LLMProvider,
  OfflineProvider,
} from "@traiblazer/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docxHtmlToText, FILE_LIMITS, FileReadError, fileSections, readSourceFile } from "./files.js";
import { syncSource } from "./sync.js";

// ---- Files made for the tests ----------------------------------------------------------------

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

/** A zip with uncompressed entries. `declared` overrides the unpacked size its directory states. */
function makeZip(files: Record<string, string>, declared?: number): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const nameBytes = Buffer.from(name, "utf8");
    const sum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(sum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(declared ?? data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    directory.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const entries = Object.keys(files).length;
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries, 8);
  end.writeUInt16LE(entries, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const paragraph = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const row = (...cells: string[]) =>
  `<w:tr>${cells.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`;

/** A Word document from the XML of its body. */
function makeDocx(body: string, declared?: number): Buffer {
  return makeZip(
    {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      "word/styles.xml": `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
      "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    },
    declared,
  );
}

const PDF: SourceFileType = "application/pdf";
const DOCX: SourceFileType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const priceList = makePdf([
  "Lakehead Auto & Tire - Price list",
  "Seasonal tire changeover (on rims)   $49.99",
  "Oil change with synthetic oil   $89 + tax",
  "Call 807-555-0142 to book.",
]);
// A real 1x1 PNG is enough: the model that "reads" it is scripted.
const photo = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** A model that can see images and replies with the next scripted text. */
class VisionProvider implements LLMProvider {
  readonly id = "vision";
  requests: ChatRequest[] = [];
  constructor(private readonly replies: string[]) {}
  supportsImages() {
    return true;
  }
  async *stream(model: string, request: ChatRequest): AsyncIterable<ChatEvent> {
    this.requests.push(request);
    yield { type: "text", text: this.replies[this.requests.length - 1] ?? "" };
    yield {
      type: "done",
      model,
      stopReason: "end",
      usage: { inputTokens: 900, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}
const gatewayFor = (provider?: VisionProvider) =>
  new LLMGateway({
    providers: [new OfflineProvider(), ...(provider ? [provider] : [])],
    routes: {
      chat: [{ provider: "offline", model: "knowledge" }],
      aux: [{ provider: "offline", model: "echo" }],
      ...(provider ? { agent: [{ provider: "vision", model: "v1" }] } : {}),
    },
  });

describe("uploaded files: reading", () => {
  it("reads a PDF's text, line by line", async () => {
    const text = await readSourceFile({ bytes: priceList, contentType: PDF });
    expect(text.split("\n")).toEqual([
      "Lakehead Auto & Tire - Price list",
      "Seasonal tire changeover (on rims) $49.99",
      "Oil change with synthetic oil $89 + tax",
      "Call 807-555-0142 to book.",
    ]);
  });

  it("says why a PDF can't be read instead of guessing", async () => {
    // A scan has pages but no text layer.
    await expect(readSourceFile({ bytes: makePdf([]), contentType: PDF })).rejects.toThrow(
      /looks like a scan/,
    );
    const broken = readSourceFile({ bytes: Buffer.from("%PDF-1.4\nnot really"), contentType: PDF });
    await expect(broken).rejects.toBeInstanceOf(FileReadError);
  });

  it("reads a Word document, keeping headings and each table row on one line", async () => {
    const docx = makeDocx(
      paragraph("Lakehead Auto &amp; Tire") +
        paragraph("Tires", "Heading1") +
        `<w:tbl>${row("Seasonal changeover (on rims)", "$49.99")}${row("Mount and balance", "from $120")}</w:tbl>` +
        paragraph("Brakes", "Heading1") +
        paragraph("Brake inspection: free with any service."),
    );
    const text = await readSourceFile({ bytes: docx, contentType: DOCX });
    expect(text).toBe(
      "Lakehead Auto & Tire\n\n# Tires\nSeasonal changeover (on rims) | $49.99\nMount and balance | from $120\n\n# Brakes\nBrake inspection: free with any service.",
    );
    expect(fileSections(text)).toEqual([
      { heading: null, text: "Lakehead Auto & Tire" },
      { heading: "Tires", text: "Seasonal changeover (on rims) | $49.99\nMount and balance | from $120" },
      { heading: "Brakes", text: "Brake inspection: free with any service." },
    ]);
    // A heading with nothing under it is kept as text.
    expect(fileSections("# Winter hours")).toEqual([{ heading: null, text: "Winter hours" }]);
  });

  it("keeps list items apart, without repeating nested ones", () => {
    expect(
      docxHtmlToText(
        "<p>We offer:</p><ul><li>Repairs<ul><li>Brakes</li></ul></li><li>Tires</li></ul><p> </p>",
      ),
    ).toBe("We offer:\n- Repairs\n- Brakes\n- Tires");
  });

  it("refuses a Word document that isn't one, or that would unpack to far too much", async () => {
    const notWord = makeZip({ "hello.txt": "hi" });
    await expect(readSourceFile({ bytes: notWord, contentType: DOCX })).rejects.toBeInstanceOf(FileReadError);
    const bomb = makeDocx(paragraph("Hello there, world"), FILE_LIMITS.docxUnpackedBytes);
    await expect(readSourceFile({ bytes: bomb, contentType: DOCX })).rejects.toThrow(/couldn't be opened/);
    const empty = makeDocx(paragraph(" "));
    await expect(readSourceFile({ bytes: empty, contentType: DOCX })).rejects.toThrow(/no text/);
  });

  it("has a photo written out by a model that can see it, and nothing more", async () => {
    const provider = new VisionProvider([
      "```\n# Price list\nOil change | $89\nTire changeover | [unreadable]\n```",
      "NO_TEXT",
    ]);
    const calls: string[] = [];
    const deps = {
      gateway: gatewayFor(provider),
      onModelCall: (meta: { model: string }) => calls.push(meta.model),
    };
    const text = await readSourceFile({ bytes: photo, contentType: "image/png" }, deps);
    expect(text).toBe("# Price list\nOil change | $89\nTire changeover | [unreadable]");
    // The model got the image itself, and rules that forbid adding anything.
    const request = provider.requests[0]!;
    expect(request.messages[0]!.content).toMatchObject([
      { type: "image", mediaType: "image/png", data: photo.toString("base64") },
      { type: "text" },
    ]);
    expect(request.system[0]!.text).toContain("Never add, complete, correct or guess");

    // A photo with nothing to read fails, and the call is still counted.
    await expect(readSourceFile({ bytes: photo, contentType: "image/png" }, deps)).rejects.toThrow(
      /No text could be read/,
    );
    expect(calls).toEqual(["v1", "v1"]);

    // Without a model that can see images, a photo can't be read at all.
    await expect(
      readSourceFile({ bytes: photo, contentType: "image/png" }, { gateway: gatewayFor() }),
    ).rejects.toThrow(/needs an AI model that can read images/);
  });
});

// ---- Against the database --------------------------------------------------------------------

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;
let owner: DbHandle;
let app: DbHandle;
let tenantId: string;
let botId: string;

async function addFile(bytes: Buffer, contentType: SourceFileType, title = "Price list") {
  const [source] = await owner.db
    .insert(knowledgeSources)
    .values({
      tenantId,
      botId,
      type: "file",
      title,
      settings: { file: { name: `${title}.bin`, contentType, sizeBytes: bytes.length } },
    })
    .returning();
  await owner.db
    .insert(sourceFiles)
    .values({ sourceId: source!.id, tenantId, contentType, bytes, sizeBytes: bytes.length, sha256: "test" });
  return source!.id;
}
const getSource = async (id: string) =>
  (await owner.db.select().from(knowledgeSources).where(eq(knowledgeSources.id, id)))[0]!;
const storedFiles = (id: string) => owner.db.select().from(sourceFiles).where(eq(sourceFiles.sourceId, id));

beforeAll(async () => {
  await runMigrations(ownerUrl);
  owner = createDb(ownerUrl, { max: 2 });
  app = createDb(appUrl, { max: 4 });
  const [tenant] = await owner.db
    .insert(tenants)
    .values({ name: "Lakehead Auto & Tire", slug: `files-${crypto.randomUUID().slice(0, 8)}` })
    .returning();
  tenantId = tenant!.id;
  const [bot] = await owner.db
    .insert(bots)
    .values({ tenantId, name: "Shop assistant", pack: "generic" })
    .returning();
  botId = bot!.id;
});

afterAll(async () => {
  if (tenantId) await owner?.db.delete(tenants).where(eq(tenants.id, tenantId));
  await app?.close();
  await owner?.close();
});

describe("uploaded files: sources", () => {
  it("reads a file once, keeps its text and removes the file", async () => {
    const sourceId = await addFile(priceList, PDF);
    await syncSource({ db: app.db }, tenantId, sourceId);

    const source = await getSource(sourceId);
    expect(source).toMatchObject({ status: "ready", error: null, documentCount: 1 });
    expect(source.content).toContain("Oil change with synthetic oil $89 + tax");
    expect(await storedFiles(sourceId)).toEqual([]);

    const [document] = await owner.db.select().from(documents).where(eq(documents.sourceId, sourceId));
    expect(document).toMatchObject({ url: `file:${sourceId}`, title: "Price list", content: source.content });
    const pieces = await owner.db.select().from(chunks).where(eq(chunks.documentId, document!.id));
    expect(pieces.map((piece) => piece.content).join("\n")).toContain("Seasonal tire changeover");

    // A refresh re-indexes the kept text: the file isn't needed again.
    await syncSource({ db: app.db }, tenantId, sourceId);
    expect(await getSource(sourceId)).toMatchObject({ status: "ready", content: source.content });
  });

  it("records what reading a photo cost, and reads it only once", async () => {
    const provider = new VisionProvider(["# Menu\nLatte | $4.50"]);
    const sourceId = await addFile(photo, "image/png", "Menu board");
    await syncSource({ db: app.db, gateway: gatewayFor(provider) }, tenantId, sourceId);
    expect(await getSource(sourceId)).toMatchObject({ status: "ready", content: "# Menu\nLatte | $4.50" });

    await syncSource({ db: app.db, gateway: gatewayFor(provider) }, tenantId, sourceId);
    expect(provider.requests).toHaveLength(1);
    const usage = await withTenant(app.db, tenantId, (tx) =>
      tx.select().from(usageEvents).where(eq(usageEvents.botId, botId)),
    );
    expect(usage).toMatchObject([
      { kind: "llm.agent", quantity: 960, metadata: { task: "file_read", sourceId, model: "v1" } },
    ]);
  });

  it("tells the owner why a file couldn't be read, without retrying", async () => {
    const sourceId = await addFile(photo, "image/png", "Sign");
    // No model that can see images: the job ends (no throw), the reason is on the source.
    await syncSource({ db: app.db, gateway: gatewayFor() }, tenantId, sourceId);
    const failed = await getSource(sourceId);
    expect(failed).toMatchObject({ status: "failed", content: null });
    expect(failed.error).toMatch(/needs an AI model that can read images/);
    // The file is kept, so a refresh reads it once a model is connected.
    expect(await storedFiles(sourceId)).toHaveLength(1);
    await syncSource(
      { db: app.db, gateway: gatewayFor(new VisionProvider(["Open daily 8 to 5"])) },
      tenantId,
      sourceId,
    );
    expect(await getSource(sourceId)).toMatchObject({ status: "ready", content: "Open daily 8 to 5" });
  });
});
