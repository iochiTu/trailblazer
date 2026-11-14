CREATE TABLE "item_stats" (
	"tenant_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"day" date NOT NULL,
	"surface" text NOT NULL,
	"shown" integer DEFAULT 0 NOT NULL,
	"tapped" integer DEFAULT 0 NOT NULL,
	"requested" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "item_stats_pk" PRIMARY KEY("tenant_id","bot_id","item_id","day","surface")
);
--> statement-breakpoint
ALTER TABLE "item_stats" ADD CONSTRAINT "item_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_stats" ADD CONSTRAINT "item_stats_item_id_catalog_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_stats" ADD CONSTRAINT "item_stats_bot_tenant_fk" FOREIGN KEY ("bot_id","tenant_id") REFERENCES "public"."bots"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_stats_bot_day_idx" ON "item_stats" USING btree ("tenant_id","bot_id","day");--> statement-breakpoint
-- Tenant isolation, like page_stats (same policy as 0001_rls.sql).
ALTER TABLE "item_stats" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "item_stats"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
