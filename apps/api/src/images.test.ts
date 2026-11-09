import { describe, expect, it } from "vitest";
import { admitImages } from "./lib/chat-guard.js";
import { prepareChatImage, stripImageMetadata } from "./lib/images.js";
import { MemoryLimiter } from "./lib/limiter.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);

const segment = (marker: number, payload: Buffer) => {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
};

/** A JPEG-structured file with EXIF (GPS), XMP-like APP1, IPTC and a comment. */
const jpegWithMetadata = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  segment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
  segment(0xe1, Buffer.from("Exif\0\0GPS 48.38N 89.25W", "latin1")),
  segment(0xed, Buffer.from("Photoshop 3.0\0IPTC-author", "latin1")),
  segment(0xfe, Buffer.from("secret comment", "latin1")),
  segment(0xdb, Buffer.alloc(65, 1)),
  segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
  Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]),
]);

const pngChunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
};

describe("chat image validation", () => {
  it("strips EXIF, IPTC and comments from JPEGs and keeps the image data", () => {
    const clean = stripImageMetadata(jpegWithMetadata, "image/jpeg")!;
    const text = clean.toString("latin1");
    expect(text).not.toContain("GPS");
    expect(text).not.toContain("IPTC");
    expect(text).not.toContain("secret");
    expect(text).toContain("JFIF");
    // Everything from the start of scan onwards is unchanged.
    const sos = jpegWithMetadata.indexOf(Buffer.from([0xff, 0xda]));
    expect(clean.subarray(clean.indexOf(Buffer.from([0xff, 0xda])))).toEqual(jpegWithMetadata.subarray(sos));
  });

  it("strips text and EXIF chunks from PNGs", () => {
    const iend = PNG_1X1.length - 12;
    const tagged = Buffer.concat([
      PNG_1X1.subarray(0, iend),
      pngChunk("tEXt", Buffer.from("Author\0Jane Visitor", "latin1")),
      pngChunk("eXIf", Buffer.from("GPS", "latin1")),
      PNG_1X1.subarray(iend),
    ]);
    const clean = stripImageMetadata(tagged, "image/png")!;
    expect(clean).toEqual(PNG_1X1);
  });

  it("strips EXIF and XMP chunks from WebP and clears their flags", () => {
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.write(type, 0, "latin1");
      head.writeUInt32LE(data.length, 4);
      return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
    };
    const vp8x = Buffer.alloc(10);
    vp8x[0] = 0x08 | 0x04;
    const body = Buffer.concat([
      chunk("VP8X", vp8x),
      chunk("VP8 ", Buffer.alloc(10, 7)),
      chunk("EXIF", Buffer.from("GPS!!", "latin1")),
      chunk("XMP ", Buffer.from("<x:xmpmeta/>", "latin1")),
    ]);
    const riff = Buffer.alloc(12);
    riff.write("RIFF", 0, "latin1");
    riff.writeUInt32LE(body.length + 4, 4);
    riff.write("WEBP", 8, "latin1");
    const clean = stripImageMetadata(Buffer.concat([riff, body]), "image/webp")!;
    expect(clean.toString("latin1")).not.toContain("GPS");
    expect(clean.toString("latin1")).not.toContain("xmpmeta");
    expect(clean.readUInt32LE(4)).toBe(clean.length - 8);
    expect(clean[20]! & 0x0c).toBe(0);
  });

  it("checks the content, not the name, and rejects malformed or oversized files", () => {
    expect(prepareChatImage(PNG_1X1.toString("base64"), 1024)).toMatchObject({
      ok: true,
      contentType: "image/png",
    });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(prepareChatImage(svg.toString("base64"), 1024)).toEqual({ ok: false, reason: "type" });
    // Looks like a JPEG for the first bytes, but the structure is broken.
    const fake = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 1, 2, 3]);
    expect(prepareChatImage(fake.toString("base64"), 1024)).toEqual({ ok: false, reason: "type" });
    const truncatedPng = PNG_1X1.subarray(0, PNG_1X1.length - 12);
    expect(prepareChatImage(truncatedPng.toString("base64"), 1024)).toEqual({ ok: false, reason: "type" });
    expect(prepareChatImage(PNG_1X1.toString("base64"), 10)).toEqual({ ok: false, reason: "size" });
    expect(prepareChatImage("", 1024)).toEqual({ ok: false, reason: "size" });
  });
});

describe("image upload limits", () => {
  it("limits images per visitor and per business", async () => {
    const limiter = new MemoryLimiter();
    const limits = { visitorPerHour: 3, tenantPerHour: 5 };
    const visitor = (visitorId: string, count: number) =>
      admitImages(limiter, { tenantId: "t1", visitorId, count }, limits);
    expect(await visitor("a", 3)).toBe(true);
    expect(await visitor("a", 1)).toBe(false);
    expect(await visitor("b", 2)).toBe(true);
    // The business's hourly total (5) is now used up, even for a new visitor.
    expect(await visitor("c", 1)).toBe(false);
    expect(await admitImages(limiter, { tenantId: "t2", visitorId: "a", count: 1 }, limits)).toBe(true);
  });
});
