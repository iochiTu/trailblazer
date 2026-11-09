/**
 * Detects the image type from the file's first bytes (never trusting the declared type).
 * Only raster formats are accepted: SVG can carry scripts and is rejected.
 */
export function sniffImageType(bytes: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export type RasterType = NonNullable<ReturnType<typeof sniffImageType>>;

/**
 * Removes metadata (EXIF with GPS position and camera details, XMP, IPTC, comments, text chunks)
 * without re-encoding the pixels. Returns null when the file's structure is malformed, so broken
 * or disguised files are rejected rather than passed on.
 */
export function stripImageMetadata(bytes: Buffer, type: RasterType): Buffer | null {
  try {
    if (type === "image/jpeg") return stripJpeg(bytes);
    if (type === "image/png") return stripPng(bytes);
    return stripWebp(bytes);
  } catch {
    return null;
  }
}

/** JPEG: drops APP1 (EXIF/XMP), APP12/APP13 (Ducky/IPTC/Photoshop) and comment segments. */
function stripJpeg(bytes: Buffer): Buffer | null {
  const DROP = new Set([0xe1, 0xec, 0xed, 0xfe]);
  const parts: Buffer[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    // Start of scan: the rest is entropy-coded image data (and any later segments) — keep it.
    if (marker === 0xda) {
      parts.push(bytes.subarray(i));
      return Buffer.concat(parts);
    }
    if (marker === 0xd9) return null; // end of image before any scan
    if (marker >= 0xd0 && marker <= 0xd7) return null;
    if (i + 4 > bytes.length) return null;
    const length = bytes.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > bytes.length) return null;
    if (!DROP.has(marker)) parts.push(bytes.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  return null;
}

/** PNG: drops text, EXIF and timestamp chunks; keeps everything needed to render. */
function stripPng(bytes: Buffer): Buffer | null {
  const DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
  const parts: Buffer[] = [bytes.subarray(0, 8)];
  let i = 8;
  let ended = false;
  while (i < bytes.length) {
    if (i + 12 > bytes.length) return null;
    const length = bytes.readUInt32BE(i);
    const type = bytes.subarray(i + 4, i + 8).toString("latin1");
    const end = i + 12 + length;
    if (end > bytes.length) return null;
    if (!DROP.has(type)) parts.push(bytes.subarray(i, end));
    i = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  return ended ? Buffer.concat(parts) : null;
}

/** WebP: drops EXIF and XMP chunks and clears their flags in the VP8X header. */
function stripWebp(bytes: Buffer): Buffer | null {
  if (bytes.length < 12) return null;
  const parts: Buffer[] = [];
  let i = 12;
  while (i < bytes.length) {
    if (i + 8 > bytes.length) return null;
    const type = bytes.subarray(i, i + 4).toString("latin1");
    const size = bytes.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);
    if (i + 8 + size > bytes.length) return null;
    if (type === "VP8X") {
      const chunk = Buffer.from(bytes.subarray(i, Math.min(end, bytes.length)));
      chunk[8] = chunk[8]! & ~(0x08 | 0x04); // EXIF and XMP flags
      parts.push(chunk);
    } else if (type !== "EXIF" && type !== "XMP ") {
      parts.push(bytes.subarray(i, Math.min(end, bytes.length)));
    }
    i = end;
  }
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  return Buffer.concat([header, body]);
}

/**
 * Validates a visitor's chat image by its content and strips its metadata. Returns the cleaned
 * image, or an error message the chat can show.
 */
export function prepareChatImage(
  base64: string,
  maxBytes: number,
): { ok: true; bytes: Buffer; contentType: RasterType } | { ok: false; reason: "type" | "size" } {
  const raw = Buffer.from(base64, "base64");
  if (!raw.length || raw.length > maxBytes) return { ok: false, reason: "size" };
  const contentType = sniffImageType(raw);
  if (!contentType) return { ok: false, reason: "type" };
  const bytes = stripImageMetadata(raw, contentType);
  if (!bytes) return { ok: false, reason: "type" };
  return { ok: true, bytes, contentType };
}
