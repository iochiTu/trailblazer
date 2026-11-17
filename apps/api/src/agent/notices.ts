import { defineAgentTool, type Toolkit } from "@traiblazer/core";
import { notices } from "@traiblazer/db";
import { NOTICE_LIMIT } from "@traiblazer/shared";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { inScope, json } from "./scope.js";

const columns = {
  id: notices.id,
  kind: notices.kind,
  title: notices.title,
  text: notices.text,
  startsAt: notices.startsAt,
  endsAt: notices.endsAt,
};

const instant = z.iso
  .datetime({ offset: true })
  .describe("Date and time with the business's UTC offset, e.g. 2026-12-24T17:00:00-05:00");

/** Time-limited announcements (a holiday closure, a delay), shown on the page and told to visitors. */
export const noticesToolkit: Toolkit = {
  id: "notices",
  title: "Notices (closures and announcements)",
  instructions: [
    "A notice is a short announcement visitors see on the page and that the assistant tells them while it runs: a holiday closure, special hours for a day, a delay.",
    "Use a notice, not the weekly hours, for anything that happens once. Give it a start and an end in the business's time zone (the end is when it stops showing), and say the dates in the text itself.",
    "Promotions (offers) are managed on the page tab; these tools only handle plain notices.",
    "Ask the person to confirm before removing a notice.",
  ].join("\n"),
  tools: [
    defineAgentTool({
      name: "list_notices",
      description: "The business's notices and offers, with their ids, start and end.",
      input: z.object({}),
      effect: "read",
      run: async (_input, ctx) => {
        const rows = await inScope(ctx, (tx) =>
          tx
            .select(columns)
            .from(notices)
            .where(eq(notices.botId, ctx.botId))
            .orderBy(asc(notices.createdAt)),
        );
        return { content: json({ notices: rows, limit: NOTICE_LIMIT }) };
      },
    }),
    defineAgentTool({
      name: "add_notice",
      description:
        "Add a notice (e.g. a holiday closure). startsAt and endsAt are optional; without an end it shows until removed.",
      input: z
        .object({
          text: z.string().trim().min(1).max(300),
          startsAt: instant.optional(),
          endsAt: instant.optional(),
        })
        .refine((n) => !n.startsAt || !n.endsAt || new Date(n.endsAt) > new Date(n.startsAt), {
          path: ["endsAt"],
          message: "The end must be after the start",
        }),
      effect: "write",
      run: async (input, ctx) => {
        const row = await inScope(ctx, async (tx) => {
          const [used] = await tx.select({ n: count() }).from(notices).where(eq(notices.botId, ctx.botId));
          if ((used?.n ?? 0) >= NOTICE_LIMIT) return null;
          const [created] = await tx
            .insert(notices)
            .values({
              tenantId: ctx.tenantId,
              botId: ctx.botId,
              kind: "notice",
              text: input.text,
              startsAt: input.startsAt ? new Date(input.startsAt) : null,
              endsAt: input.endsAt ? new Date(input.endsAt) : null,
            })
            .returning(columns);
          await audit(tx, {
            tenantId: ctx.tenantId,
            actorUserId: ctx.userId,
            action: "notice.created",
            targetType: "notice",
            targetId: created!.id,
            metadata: { via: "agent" },
          });
          return created!;
        });
        if (!row) {
          return {
            isError: true,
            content: `The business already has ${NOTICE_LIMIT} notices, the most it can have. Remove one first.`,
          };
        }
        return {
          content: json({ added: row }),
          changes: [{ area: "notices", summary: `Notice added: "${row.text}"` }],
        };
      },
    }),
    defineAgentTool({
      name: "remove_notice",
      description: "Delete a notice. Only after the person confirmed it.",
      input: z.object({ id: z.uuid().describe("The notice's id, from list_notices") }),
      effect: "write",
      run: async ({ id }, ctx) => {
        const removed = await inScope(ctx, async (tx) => {
          const [row] = await tx
            .delete(notices)
            .where(and(eq(notices.id, id), eq(notices.botId, ctx.botId)))
            .returning({ id: notices.id, text: notices.text });
          if (row) {
            await audit(tx, {
              tenantId: ctx.tenantId,
              actorUserId: ctx.userId,
              action: "notice.deleted",
              targetType: "notice",
              targetId: id,
              metadata: { via: "agent" },
            });
          }
          return row ?? null;
        });
        if (!removed)
          return { isError: true, content: "No notice with that id. Call list_notices for the ids." };
        return {
          content: json({ removed }),
          changes: [{ area: "notices", summary: `Notice removed: "${removed.text}"` }],
        };
      },
    }),
  ],
};
