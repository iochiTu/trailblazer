import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

export function createDb(url: string, options: { max?: number } = {}): DbHandle {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction scoped to one tenant. Row-level security policies read
 * `app.tenant_id`, so every query inside `fn` only sees and writes that tenant's rows.
 * The setting is transaction-local (`set_config(..., true)`), so it never leaks to other
 * requests sharing the same pooled connection.
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error("withTenant: tenantId must be a UUID");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * Resolves a public widget key to its bot and tenant before any tenant context exists.
 * Backed by a SECURITY DEFINER function so the app role never needs cross-tenant read access.
 */
export async function resolveBotKey(
  db: Db,
  publicKey: string,
): Promise<{ tenantId: string; botId: string; allowedOrigins: string[] } | null> {
  const rows = await db.execute<{ tenant_id: string; bot_id: string; allowed_origins: string[] }>(
    sql`select tenant_id, bot_id, allowed_origins from app_resolve_bot_key(${publicKey})`,
  );
  const row = rows[0];
  return row ? { tenantId: row.tenant_id, botId: row.bot_id, allowedOrigins: row.allowed_origins } : null;
}

/** The public key of the assistant whose business page has this friendly link, without tenant context. */
export async function resolvePageSlug(db: Db, slug: string): Promise<string | null> {
  const rows = await db.execute<{ public_key: string }>(
    sql`select public_key from app_resolve_page_slug(${slug})`,
  );
  return rows[0]?.public_key ?? null;
}

/** Reads a public image (e.g. an assistant avatar) by id, without tenant context. */
export async function getPublicAsset(
  db: Db,
  id: string,
): Promise<{ contentType: string; bytes: Buffer; sha256: string } | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await db.execute<{ content_type: string; bytes: Buffer; sha256: string }>(
    sql`select content_type, bytes, sha256 from app_get_public_asset(${id}::uuid)`,
  );
  const row = rows[0];
  return row ? { contentType: row.content_type, bytes: row.bytes, sha256: row.sha256 } : null;
}
