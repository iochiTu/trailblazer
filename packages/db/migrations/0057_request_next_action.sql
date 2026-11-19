ALTER TABLE "leads" ADD COLUMN "next_action" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "action_version" integer DEFAULT 0 NOT NULL;