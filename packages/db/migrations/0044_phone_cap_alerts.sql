ALTER TABLE "phone_numbers" ADD COLUMN "daily_cap_cents" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN "cap_alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN "alert_number" text;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN "alert_requests" text DEFAULT 'all' NOT NULL;