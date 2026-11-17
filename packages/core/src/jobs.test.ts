import { createDb, type Db, type DbHandle, jobs, runMigrations, tenants } from "@traiblazer/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { claimNextJob, completeJob, failJob, renewJobLease } from "./jobs.js";

let first: DbHandle;
let second: DbHandle;
const tenantId = crypto.randomUUID();

beforeAll(async () => {
  await runMigrations(process.env.TEST_DATABASE_URL!);
  first = createDb(process.env.TEST_DATABASE_APP_URL!, { max: 1 });
  second = createDb(process.env.TEST_DATABASE_APP_URL!, { max: 1 });
  await first.db.insert(tenants).values({ id: tenantId, name: "Queue test", slug: tenantId });
});
afterAll(async () => {
  await first?.db.delete(tenants).where(eq(tenants.id, tenantId));
  await first?.close();
  await second?.close();
});

async function enqueue(priority = 1_000_000) {
  const [row] = await first.db
    .insert(jobs)
    .values({ tenantId, type: "test", priority, maxAttempts: 2 })
    .returning();
  return row!.id;
}

async function claim(db: Db, worker: string, id: string) {
  const job = await claimNextJob(db, worker);
  expect(job?.id).toBe(id);
  return job!;
}

const expire = (id: string) =>
  first.db.update(jobs).set({ lockedAt: sql`now() - interval '16 minutes'` }).where(eq(jobs.id, id));
const read = async (id: string) => (await first.db.select().from(jobs).where(eq(jobs.id, id)))[0]!;

it.each(["worker-b", "worker-a"])("rejects every stale write when %s takes over", async (nextWorker) => {
  const id = await enqueue();
  const stale = await claim(first.db, "worker-a", id);
  await expire(id);
  expect(await renewJobLease(first.db, stale)).toBe(false);
  expect(await completeJob(first.db, stale)).toBe(false);
  const current = await claim(second.db, nextWorker, id);
  expect(current.attempts).toBe(stale.attempts + 1);
  const reclaimed = await read(id);
  expect(await renewJobLease(first.db, stale)).toBe(false);
  expect(await completeJob(first.db, stale)).toBe(false);
  expect(await failJob(first.db, stale, new Error("late failure"))).toBe("lost");
  expect(await read(id)).toEqual(reclaimed);
  expect(await completeJob(second.db, current)).toBe(true);
  expect(await failJob(first.db, stale, "late")).toBe("lost");
  expect(await read(id)).toMatchObject({ status: "done", lockedBy: null, lockedAt: null, lastError: null });
});

it("renews a running job and preserves backoff and final failure for its current owner", async () => {
  const id = await enqueue();
  const running = await claim(first.db, "worker-a", id);
  await first.db.update(jobs).set({ lockedAt: sql`now() - interval '14 minutes'` }).where(eq(jobs.id, id));
  const previous = await read(id);
  expect(await renewJobLease(first.db, running)).toBe(true);
  const renewed = await read(id);
  expect(renewed.lockedAt!.getTime()).toBeGreaterThan(previous.lockedAt!.getTime());
  expect(renewed.attempts).toBe(running.attempts);
  const other = await enqueue(999_999);
  const otherClaim = await claim(second.db, "worker-b", other);
  expect(await completeJob(second.db, otherClaim)).toBe(true);
  const before = Date.now();
  expect(await failJob(first.db, running, new Error("retry me"))).toBe("retry");
  const queued = await read(id);
  expect(queued).toMatchObject({ status: "queued", lockedBy: null, lockedAt: null, lastError: "retry me" });
  expect(queued.runAt.getTime()).toBeGreaterThanOrEqual(before + 30_000);
  await first.db.update(jobs).set({ runAt: sql`now()` }).where(eq(jobs.id, id));
  const retry = await claim(second.db, "worker-b", id);
  expect(await failJob(second.db, retry, new Error("final"))).toBe("failed");
  expect(await completeJob(first.db, running)).toBe(false);
  expect(await read(id)).toMatchObject({
    status: "failed",
    attempts: 2,
    lockedBy: null,
    lockedAt: null,
    lastError: "final",
  });
});
