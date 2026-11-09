import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle, resolveBotKey, withTenant } from "./client.js";
import { runMigrations } from "./migrator.js";
import {
  assets,
  botKeys,
  bots,
  businessProfiles,
  conversations,
  knowledgeImages,
  messageAttachments,
  messages,
  rlsTables,
  tenants,
} from "./schema.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;

let owner: DbHandle;
let app: DbHandle;
let tenantA: string;
let tenantB: string;
let botB: string;

beforeAll(async () => {
  await runMigrations(ownerUrl);
  owner = createDb(ownerUrl, { max: 2 });
  app = createDb(appUrl, { max: 2 });

  const suffix = crypto.randomUUID().slice(0, 8);
  const [a] = await owner.db
    .insert(tenants)
    .values({ name: "A", slug: `a-${suffix}` })
    .returning();
  const [b] = await owner.db
    .insert(tenants)
    .values({ name: "B", slug: `b-${suffix}` })
    .returning();
  tenantA = a!.id;
  tenantB = b!.id;

  await owner.db.insert(bots).values({ tenantId: tenantA, name: "Bot A", pack: "restaurant" });
  const [bb] = await owner.db
    .insert(bots)
    .values({ tenantId: tenantB, name: "Bot B", pack: "retail" })
    .returning();
  botB = bb!.id;
  await owner.db.insert(botKeys).values({
    tenantId: tenantB,
    botId: botB,
    publicKey: `pk_test_${suffix}`,
    allowedOrigins: ["https://b.example"],
  });
});

afterAll(async () => {
  await owner?.db.delete(tenants).where(eq(tenants.id, tenantA));
  await owner?.db.delete(tenants).where(eq(tenants.id, tenantB));
  await app?.close();
  await owner?.close();
});

describe("row-level security", () => {
  it("app role is not allowed to bypass RLS", async () => {
    const rows = await app.db.execute<{ rolbypassrls: boolean; rolsuper: boolean }>(
      sql`select rolbypassrls, rolsuper from pg_roles where rolname = current_user`,
    );
    expect(rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it("returns no tenant rows when no tenant is set", async () => {
    const rows = await app.db.select().from(bots);
    expect(rows).toHaveLength(0);
  });

  it("only returns the current tenant's rows", async () => {
    const rowsA = await withTenant(app.db, tenantA, (tx) => tx.select().from(bots));
    expect(rowsA.map((r) => r.name)).toEqual(["Bot A"]);

    const rowsB = await withTenant(app.db, tenantB, (tx) => tx.select().from(bots));
    expect(rowsB.map((r) => r.name)).toEqual(["Bot B"]);
  });

  it("does not leak tenant context to the next transaction", async () => {
    await withTenant(app.db, tenantA, (tx) => tx.select().from(bots));
    const rows = await app.db.select().from(bots);
    expect(rows).toHaveLength(0);
  });

  it("rejects writes for another tenant", async () => {
    await expect(
      withTenant(app.db, tenantA, (tx) =>
        tx.insert(bots).values({ tenantId: tenantB, name: "x", pack: "retail" }),
      ),
    ).rejects.toThrow();
  });

  it("rejects child rows pointing at another tenant's bot", async () => {
    await expect(
      withTenant(app.db, tenantA, (tx) =>
        tx.insert(businessProfiles).values({ tenantId: tenantA, botId: botB }),
      ),
    ).rejects.toThrow();
  });

  it("cannot update or delete another tenant's rows", async () => {
    const updated = await withTenant(app.db, tenantA, (tx) =>
      tx.update(bots).set({ name: "hacked" }).where(eq(bots.id, botB)).returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await withTenant(app.db, tenantA, (tx) =>
      tx.delete(bots).where(eq(bots.id, botB)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("resolves a public widget key without tenant context", async () => {
    const keys = await withTenant(app.db, tenantB, (tx) => tx.select().from(botKeys));
    const resolved = await resolveBotKey(app.db, keys[0]!.publicKey);
    expect(resolved).toEqual({ tenantId: tenantB, botId: botB, allowedOrigins: ["https://b.example"] });
    expect(await resolveBotKey(app.db, "pk_test_missing")).toBeNull();
  });

  it("keeps visitors' chat images within their business", async () => {
    const image = await withTenant(app.db, tenantB, async (tx) => {
      const [conversation] = await tx
        .insert(conversations)
        .values({ tenantId: tenantB, botId: botB, channel: "hosted", visitorId: "visitor-rls" })
        .returning();
      const [message] = await tx
        .insert(messages)
        .values({ tenantId: tenantB, conversationId: conversation!.id, role: "user", content: "" })
        .returning();
      const [row] = await tx
        .insert(messageAttachments)
        .values({
          tenantId: tenantB,
          botId: botB,
          conversationId: conversation!.id,
          messageId: message!.id,
          name: "photo.jpg",
          contentType: "image/jpeg",
          sizeBytes: 3,
          sha256: "x",
          dataBase64: "AAAA",
        })
        .returning();
      return { ...row!, conversationId: conversation!.id, messageId: message!.id };
    });

    expect(await app.db.select().from(messageAttachments)).toHaveLength(0);
    expect(await withTenant(app.db, tenantA, (tx) => tx.select().from(messageAttachments))).toHaveLength(0);
    const own = await withTenant(app.db, tenantB, (tx) => tx.select().from(messageAttachments));
    expect(own.map((r) => r.id)).toEqual([image.id]);

    // Another business can't change or delete it, or attach an image to B's conversation.
    const updated = await withTenant(app.db, tenantA, (tx) =>
      tx
        .update(messageAttachments)
        .set({ dataBase64: "BBBB" })
        .where(eq(messageAttachments.id, image.id))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await withTenant(app.db, tenantA, (tx) =>
      tx.delete(messageAttachments).where(eq(messageAttachments.id, image.id)).returning(),
    );
    expect(deleted).toHaveLength(0);
    await expect(
      withTenant(app.db, tenantA, (tx) =>
        tx.insert(messageAttachments).values({
          tenantId: tenantA,
          botId: botB,
          conversationId: image.conversationId,
          messageId: image.messageId,
          name: "x.png",
          contentType: "image/png",
          sizeBytes: 1,
          sha256: "x",
          dataBase64: "AA==",
        }),
      ),
    ).rejects.toThrow();

    // Deleting the message removes its images.
    await withTenant(app.db, tenantB, (tx) => tx.delete(messages).where(eq(messages.id, image.messageId)));
    expect(await withTenant(app.db, tenantB, (tx) => tx.select().from(messageAttachments))).toHaveLength(0);
  });

  it("keeps business photos within their business and serves only published kinds publicly", async () => {
    const photo = await withTenant(app.db, tenantB, async (tx) => {
      const [asset] = await tx
        .insert(assets)
        .values({
          tenantId: tenantB,
          kind: "knowledge_image",
          contentType: "image/png",
          bytes: Buffer.from("png"),
          sizeBytes: 3,
          sha256: "x",
        })
        .returning();
      const [row] = await tx
        .insert(knowledgeImages)
        .values({
          tenantId: tenantB,
          botId: botB,
          assetId: asset!.id,
          title: "Patio",
          description: "Summer patio",
          tsv: sql`to_tsvector('simple', 'patio')` as unknown as string,
        })
        .returning();
      return { id: row!.id, assetId: asset!.id };
    });
    expect(await app.db.select().from(knowledgeImages)).toHaveLength(0);
    expect(await withTenant(app.db, tenantA, (tx) => tx.select().from(knowledgeImages))).toHaveLength(0);
    const changed = await withTenant(app.db, tenantA, (tx) =>
      tx.update(knowledgeImages).set({ title: "x" }).where(eq(knowledgeImages.id, photo.id)).returning(),
    );
    expect(changed).toHaveLength(0);
    await expect(
      withTenant(app.db, tenantA, (tx) =>
        tx.insert(knowledgeImages).values({
          tenantId: tenantA,
          botId: botB,
          assetId: photo.assetId,
          title: "x",
          description: "x",
          tsv: sql`to_tsvector('simple', 'x')` as unknown as string,
        }),
      ),
    ).rejects.toThrow();
    // Shown to visitors, so readable through the public-asset function without tenant context.
    const rows = await app.db.execute<{ content_type: string }>(
      sql`select content_type from app_get_public_asset(${photo.assetId}::uuid)`,
    );
    expect(rows.map((r) => r.content_type)).toEqual(["image/png"]);
  });

  it("rejects a non-UUID tenant id", async () => {
    await expect(withTenant(app.db, "' or 1=1 --", async () => 1)).rejects.toThrow(/UUID/);
  });

  it("enables RLS with a policy on every tenant-owned table", async () => {
    const rows = await owner.db.execute<{ relname: string; rls: boolean; policies: number }>(sql`
      select c.relname, c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
      from pg_class c
      where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
        and exists (select 1 from information_schema.columns col
                    where col.table_name = c.relname and col.column_name = 'tenant_id')
    `);
    const platformTables = new Set(["memberships", "jobs"]);
    for (const row of rows) {
      if (platformTables.has(row.relname)) continue;
      expect(row.rls, row.relname).toBe(true);
      expect(row.policies, row.relname).toBeGreaterThan(0);
    }
    expect([...rlsTables].sort()).toEqual(
      rows
        .map((r) => r.relname)
        .filter((n) => !platformTables.has(n))
        .sort(),
    );
  });
});
