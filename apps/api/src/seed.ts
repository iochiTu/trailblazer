/**
 * Local demo data: one business owner account with a restaurant assistant, and a separate
 * Traiblazer staff (super admin) account for the operator console.
 * Runs as the owner role (DATABASE_URL). Safe to re-run: skips what already exists.
 */
import { botKeys, bots, businessProfiles, createDb, memberships, tenants, users } from "@traiblazer/db";
import { getTemplate } from "@traiblazer/industry-packs";
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth/password.js";
import { newPublicKey, slugify } from "./lib/ids.js";

const DEMO_EMAIL = "demo@traiblazer.local";
const DEMO_PASSWORD = "demo-password-123";
const STAFF_EMAIL = "staff@traiblazer.local";
const STAFF_PASSWORD = "staff-password-123";
const DEMO_TEMPLATE = getTemplate("restaurant", "casual");

const url = process.env.DATABASE_URL ?? "postgres://traiblazer:traiblazer@localhost:5433/traiblazer";
const { db, close } = createDb(url, { max: 1 });

try {
  const [existing] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
  if (existing) {
    console.log(`Demo user already exists: ${DEMO_EMAIL}`);
  } else {
    await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: DEMO_EMAIL,
          name: "Demo Owner",
          passwordHash: await hashPassword(DEMO_PASSWORD),
        })
        .returning();
      const [tenant] = await tx
        .insert(tenants)
        .values({ name: "Lakeside Bistro", slug: slugify("Lakeside Bistro") })
        .returning();
      await tx.insert(memberships).values({ tenantId: tenant!.id, userId: user!.id, role: "owner" });
      const [bot] = await tx
        .insert(bots)
        .values({
          tenantId: tenant!.id,
          name: "Lakeside Bistro Assistant",
          pack: "restaurant",
          variant: "casual",
          // Like a real assistant: starts with a copy of its industry template.
          guidelines: DEMO_TEMPLATE.guidelines,
          workflows: DEMO_TEMPLATE.workflows,
          languages: ["en", "fr", "zh-Hans", "pa"],
          defaultLanguage: "en",
          hostedPageEnabled: true,
        })
        .returning();
      await tx.insert(businessProfiles).values({
        tenantId: tenant!.id,
        botId: bot!.id,
        businessName: "Lakeside Bistro",
        phone: "+1 807 555 0100",
        websiteUrl: "https://lakeside-bistro.example",
        timezone: "America/Thunder_Bay",
        hours: {
          tue: [{ open: "11:00", close: "21:00" }],
          wed: [{ open: "11:00", close: "21:00" }],
          thu: [{ open: "11:00", close: "21:00" }],
          fri: [{ open: "11:00", close: "22:00" }],
          sat: [{ open: "10:00", close: "22:00" }],
          sun: [{ open: "10:00", close: "20:00" }],
        },
        staffLanguages: ["en", "fr", "pa"],
      });
      await tx.insert(botKeys).values({
        tenantId: tenant!.id,
        botId: bot!.id,
        publicKey: newPublicKey(false),
        allowedOrigins: ["http://localhost:3000"],
      });
    });
    console.log(`Seeded demo data. Sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  }

  // Staff account: separate from every business (the database enforces this).
  const [staff] = await db.select().from(users).where(eq(users.email, STAFF_EMAIL)).limit(1);
  if (staff) {
    console.log(`Staff user already exists: ${STAFF_EMAIL}`);
  } else {
    await db.insert(users).values({
      email: STAFF_EMAIL,
      name: "Traiblazer Staff",
      passwordHash: await hashPassword(STAFF_PASSWORD),
      platformRole: "super_admin",
    });
    console.log(
      `Seeded staff account. Sign in as ${STAFF_EMAIL} / ${STAFF_PASSWORD} for the operator console`,
    );
  }
} finally {
  await close();
}
