CREATE TABLE "knowledge_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"language" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"tsv" "tsvector" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "images" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "knowledge_images" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_images" ADD CONSTRAINT "knowledge_images_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_images" ADD CONSTRAINT "knowledge_images_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_images" ADD CONSTRAINT "knowledge_images_bot_tenant_fk" FOREIGN KEY ("bot_id","tenant_id") REFERENCES "public"."bots"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_images_bot_idx" ON "knowledge_images" USING btree ("tenant_id","bot_id");--> statement-breakpoint
CREATE INDEX "knowledge_images_tsv_idx" ON "knowledge_images" USING gin ("tsv");