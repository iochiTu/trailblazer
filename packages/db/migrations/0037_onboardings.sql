CREATE TABLE "onboardings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"live_at" timestamp with time zone,
	"marks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboardings_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_bot_tenant_fk" FOREIGN KEY ("bot_id","tenant_id") REFERENCES "public"."bots"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboardings_due_idx" ON "onboardings" USING btree ("due_at");