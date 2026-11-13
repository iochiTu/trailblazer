import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Credentials at rest: AES-256-GCM with a key from the environment (INTEGRATIONS_SECRET_KEY), so a
 * database dump alone never exposes a business's CRM keys. Sealed values carry a version prefix so
 * the scheme or key can change later.
 */

const VERSION = "v1";
const b64 = (data: Buffer) => data.toString("base64url");

/** Reads the 32-byte key: 64 hex characters or base64. Returns null when unset; throws when malformed. */
export function parseSecretKey(value: string | undefined): Buffer | null {
  const text = value?.trim();
  if (!text) return null;
  const key = /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, "hex") : Buffer.from(text, "base64");
  if (key.length !== 32) {
    throw new Error("INTEGRATIONS_SECRET_KEY must be 32 bytes (64 hex characters, or base64)");
  }
  return key;
}

/**
 * Encrypts a JSON value. `context` (e.g. the connection's tenant and provider) is bound into the
 * seal, so a sealed value copied onto another business's row can't be opened there.
 */
export function seal(key: Buffer, value: unknown, context = ""): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(data)].join(".");
}

/** Opens a sealed value. Throws when the key, the context or the data is wrong. */
export function open<T = unknown>(key: Buffer, sealed: string, context = ""): T {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error("Unreadable sealed value");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const text = Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]);
  return JSON.parse(text.toString("utf8")) as T;
}

/** HMAC-SHA256, hex. Used to sign webhook bodies. */
export const hmacHex = (secret: string | Buffer, body: string) =>
  createHmac("sha256", secret).update(body).digest("hex");

/**
 * A signed, short-lived token carrying a small payload through a redirect (OAuth `state`): the
 * CRM sends it back unchanged, and we know who started the connection and for which assistant.
 */
export function signToken(
  key: Buffer,
  payload: Record<string, unknown>,
  ttlMs: number,
  now = Date.now(),
): string {
  const body = b64(Buffer.from(JSON.stringify({ ...payload, exp: now + ttlMs }), "utf8"));
  return `${body}.${b64(createHmac("sha256", key).update(`state:${body}`).digest())}`;
}

/** The payload of a token made by signToken, or null when it is forged, damaged or expired. */
export function readToken<T extends Record<string, unknown>>(
  key: Buffer,
  token: string,
  now = Date.now(),
): T | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", key).update(`state:${body}`).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    return typeof payload.exp === "number" && payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}
