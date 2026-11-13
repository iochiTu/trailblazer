import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent, fetch } from "undici";

/**
 * Fetching customer-supplied URLs from our servers is a server-side request forgery risk: a URL
 * could point at localhost, the cloud metadata service or the private network. Every request and
 * every redirect hop is resolved and rejected if any address is not public.
 */

export class UnsafeUrlError extends Error {
  // Named so code that can't import this class (CRM connectors) still recognises a refused address.
  override name = "UnsafeUrlError";
}

export interface SafeFetchOptions {
  /** Tests only: allow loopback/private addresses. */
  allowPrivate?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  accept?: string;
}

export const USER_AGENT = "TraiblazerBot/0.1 (+https://traiblazer.example/bot)";

/** IPv4 ranges that are not publicly routable (RFC 6890 special-purpose registry). */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  // Anything that isn't a plain dotted quad is refused rather than guessed at.
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Expands any valid IPv6 text form (compressed, with an embedded IPv4 tail) to 16 bytes. */
function ipv6Bytes(ip: string): number[] | null {
  let text = ip.toLowerCase().split("%")[0]!; // drop a zone id such as fe80::1%eth0
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const v4 = tail[1]!.split(".").map(Number);
    if (v4.some((n) => n > 255)) return null;
    const hex = (hi: number, lo: number) => ((hi << 8) | lo).toString(16);
    text = `${text.slice(0, -tail[1]!.length)}${hex(v4[0]!, v4[1]!)}:${hex(v4[2]!, v4[3]!)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = Number.parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

const v4From = (b: number[], at: number) => b.slice(at, at + 4).join(".");

function isPrivateIPv6(ip: string): boolean {
  const b = ipv6Bytes(ip);
  if (!b) return true;
  const zeros = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  // ::, ::1, IPv4-compatible (::a.b.c.d) and IPv4-mapped (::ffff:a.b.c.d): judge the IPv4 inside.
  if (zeros(0, 10) && ((b[10] === 0 && b[11] === 0) || (b[10] === 0xff && b[11] === 0xff))) {
    if (zeros(10, 15) && (b[15] === 0 || b[15] === 1)) return true;
    return isPrivateIPv4(v4From(b, 12));
  }
  // NAT64 well-known prefix 64:ff9b::/96 and local-use 64:ff9b:1::/48 reach IPv4 through a gateway.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    return (b[4] === 0 && b[5] === 1) || isPrivateIPv4(v4From(b, 12));
  }
  // 6to4 (2002::/16) embeds an IPv4 address; Teredo (2001::/32) tunnels to arbitrary hosts.
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateIPv4(v4From(b, 2));
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return true;
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // documentation
  if (b[0] === 0x01 && b[1] === 0x00 && zeros(2, 8)) return true; // discard-only 100::/64
  return (
    (b[0]! & 0xfe) === 0xfc || // unique local fc00::/7
    (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) || // link-local fe80::/10
    (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) || // deprecated site-local fec0::/10
    b[0] === 0xff // multicast
  );
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip.split("%")[0]!);
  if (version === 6) return isPrivateIPv6(ip);
  if (version === 4) return isPrivateIPv4(ip);
  return true;
}

/**
 * DNS lookup used when the connection is made: it re-checks every address it returns, so a
 * hostname that resolved to a public address during assertPublicUrl can't switch to a private one
 * by the time we connect (DNS rebinding).
 */
export const pinnedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return callback(new UnsafeUrlError("URL resolves to a private address"), "", 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
};

const publicOnlyAgent = new Agent({ connect: { lookup: pinnedLookup } });

export async function assertPublicUrl(url: URL, allowPrivate = false): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new UnsafeUrlError(`Unsupported protocol: ${url.protocol}`);
  if (url.username || url.password) throw new UnsafeUrlError("Credentials in URLs are not allowed");
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new UnsafeUrlError("Private host");
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeUrlError("URL resolves to a private address");
  }
}

/**
 * `fetch` for addresses a business gives us to call (webhooks) and for outside APIs: the address
 * must be public, the connection is pinned to the checked addresses, and redirects are refused
 * (the caller sets `redirect: "error"`; a redirect could point anywhere).
 */
export const publicFetch: typeof globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  await assertPublicUrl(url);
  return (await fetch(url, {
    ...(init as Record<string, unknown>),
    redirect: "error",
    dispatcher: publicOnlyAgent,
  })) as unknown as Response;
};

export interface SafeResponse {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

/** GET with SSRF checks on every redirect hop, a timeout and a body size limit. */
export async function safeFetch(input: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  let url = new URL(input);
  const maxBytes = options.maxBytes ?? 2_000_000;

  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(url, options.allowPrivate);
    const res = await fetch(url, {
      redirect: "manual",
      // Private-network tests skip the pinned resolver; everything else connects through it.
      ...(options.allowPrivate ? {} : { dispatcher: publicOnlyAgent }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      headers: {
        "user-agent": options.userAgent ?? USER_AGENT,
        accept: options.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8",
      },
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel();
      url = new URL(res.headers.get("location") as string, url);
      continue;
    }

    const reader = res.body?.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          break;
        }
        parts.push(value);
      }
    }
    const body = new TextDecoder("utf-8").decode(Buffer.concat(parts));
    return {
      url: url.toString(),
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body,
    };
  }
  throw new UnsafeUrlError("Too many redirects");
}
