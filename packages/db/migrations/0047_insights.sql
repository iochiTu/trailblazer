CREATE TABLE "conversation_insights" (
	"tenant_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"day" date NOT NULL,
	"channel" text NOT NULL,
	"dimension" text NOT NULL,
	"value" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "conversation_insights_pk" PRIMARY KEY("tenant_id","bot_id","day","channel","dimension","value")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "analyzed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "insights" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_insights" ADD CONSTRAINT "conversation_insights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_insights" ADD CONSTRAINT "conversation_insights_bot_tenant_fk" FOREIGN KEY ("bot_id","tenant_id") REFERENCES "public"."bots"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_insights_bot_day_idx" ON "conversation_insights" USING btree ("tenant_id","bot_id","day");--> statement-breakpoint
-- Tenant isolation, like page_stats and item_stats (same policy as 0001_rls.sql).
ALTER TABLE "conversation_insights" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "conversation_insights"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- Insights is part of the Professional and Business plans at launch (operators can change it).
UPDATE "plans" SET "insights" = true WHERE "id" IN ('professional', 'business');
