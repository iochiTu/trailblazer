ALTER TABLE "notices" ADD COLUMN "kind" text DEFAULT 'notice' NOT NULL;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "catalog_item_id" uuid;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE set null ON UPDATE no action;