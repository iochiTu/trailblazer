CREATE TABLE "setup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"suggestion" jsonb,
	"error" text,
	"model" text,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "setup_runs" ADD CONSTRAINT "setup_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_runs" ADD CONSTRAINT "setup_runs_bot_tenant_fk" FOREIGN KEY ("bot_id","tenant_id") REFERENCES "public"."bots"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "setup_runs_bot_created_idx" ON "setup_runs" USING btree ("tenant_id","bot_id","created_at");