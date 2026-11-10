CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"kind" text DEFAULT 'service' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_text" text,
	"category" text,
	"asset_id" uuid,
	"action" text DEFAULT 'ask' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"text" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "page_slug" text;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD COLUMN "service_area" text;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD COLUMN "credentials" text;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_bot_tenant_fk" FOREIGN KEY ("bot_id","tenant_id") REFERENCES "public"."bots"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_bot_tenant_fk" FOREIGN KEY ("bot_id","tenant_id") REFERENCES "public"."bots"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_items_bot_idx" ON "catalog_items" USING btree ("tenant_id","bot_id","position");--> statement-breakpoint
CREATE INDEX "notices_bot_idx" ON "notices" USING btree ("tenant_id","bot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bots_page_slug_uq" ON "bots" USING btree ("page_slug");