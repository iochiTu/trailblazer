import type { AgentContext } from "@traiblazer/core";
import { bots, type Tx, withTenant } from "@traiblazer/db";
import { eq } from "drizzle-orm";
import { notFound } from "../lib/errors.js";

/**
 * Runs fn in the business's scope (RLS applies) after checking the assistant is there. Every owner
 * tool goes through this: a tool only ever sees the business and assistant of the person it works for.
 */
export function inScope<T>(ctx: AgentContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(ctx.db, ctx.tenantId, async (tx) => {
    const [bot] = await tx.select({ id: bots.id }).from(bots).where(eq(bots.id, ctx.botId)).limit(1);
    if (!bot) throw notFound("Assistant");
    return fn(tx);
  });
}

/** A tool result for the model: data as JSON. */
export const json = (value: unknown) => JSON.stringify(value);
