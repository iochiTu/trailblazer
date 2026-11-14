ALTER TABLE "demos" ADD COLUMN "access_user_id" uuid;--> statement-breakpoint
ALTER TABLE "demos" ADD COLUMN "access_code_hash" text;--> statement-breakpoint
ALTER TABLE "demos" ADD COLUMN "access_code_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "demos" ADD COLUMN "access_last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "demos" ADD CONSTRAINT "demos_access_user_id_users_id_fk" FOREIGN KEY ("access_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demos" ADD CONSTRAINT "demos_access_code_hash_unique" UNIQUE("access_code_hash");