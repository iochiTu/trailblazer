CREATE TABLE "page_stats" (
	"tenant_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"call" integer DEFAULT 0 NOT NULL,
	"book" integer DEFAULT 0 NOT NULL,
	"email" integer DEFAULT 0 NOT NULL,
	"directions" integer DEFAULT 0 NOT NULL,
	"website" integer DEFAULT 0 NOT NULL,
	"link" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "page_stats_pk" PRIMARY KEY("tenant_id","bot_id","day")
);
--> statement-breakpoint
ALTER TABLE "page_stats" ADD CONSTRAINT "page_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_stats" ADD CONSTRAINT "page_stats_bot_tenant_fk" FOREIGN KEY ("bot_id","tenant_id") REFERENCES "public"."bots"("id","tenant_id") ON DELETE cascade ON UPDATE no action;