CREATE TABLE "source_files" (
	"source_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_source_tenant_fk" FOREIGN KEY ("source_id","tenant_id") REFERENCES "public"."knowledge_sources"("id","tenant_id") ON DELETE cascade ON UPDATE no action;