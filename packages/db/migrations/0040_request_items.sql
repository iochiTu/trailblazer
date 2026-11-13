ALTER TABLE "leads" ADD COLUMN "catalog_item_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "item_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE set null ON UPDATE no action;