CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"website" text,
	"country" text,
	"currency" text DEFAULT 'cad' NOT NULL,
	"application_note" text,
	"share_percent" integer,
	"billing_modes" text[] DEFAULT '{client_pays,agency_pays}'::text[] NOT NULL,
	"trial_client_cap" integer DEFAULT 10 NOT NULL,
	"payouts_held" boolean DEFAULT false NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agencies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "agency_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"tenant_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agency_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "suspended_by" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "agency_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "agency_billing_mode" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "agency_joined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agency_audit_logs" ADD CONSTRAINT "agency_audit_logs_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_audit_logs" ADD CONSTRAINT "agency_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_audit_logs" ADD CONSTRAINT "agency_audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_members" ADD CONSTRAINT "agency_members_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_members" ADD CONSTRAINT "agency_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agency_audit_logs_agency_idx" ON "agency_audit_logs" USING btree ("agency_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agency_members_agency_user_uq" ON "agency_members" USING btree ("agency_id","user_id");--> statement-breakpoint
CREATE INDEX "agency_members_user_idx" ON "agency_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenants_agency_idx" ON "tenants" USING btree ("agency_id");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_suspended_by_check" CHECK ("suspended_by" IN ('operator', 'agency'));--> statement-breakpoint
-- Businesses suspended before this column existed were suspended by operators.
UPDATE "tenants" SET "suspended_by" = 'operator' WHERE "status" = 'suspended';--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_status_check" CHECK ("status" IN ('applied', 'active', 'suspended', 'declined'));--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_share_percent_check" CHECK ("share_percent" IS NULL OR "share_percent" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_billing_modes_check" CHECK ("billing_modes" <@ ARRAY['client_pays', 'agency_pays']::text[]);--> statement-breakpoint
ALTER TABLE "agency_members" ADD CONSTRAINT "agency_members_role_check" CHECK ("role" IN ('owner', 'admin', 'member'));--> statement-breakpoint
-- An agency client always says who pays; a direct customer never does.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_agency_billing_mode_check" CHECK (
  ("agency_id" IS NULL AND "agency_billing_mode" IS NULL)
  OR ("agency_id" IS NOT NULL AND "agency_billing_mode" IN ('client_pays', 'agency_pays'))
);--> statement-breakpoint
-- Staff accounts stay out of agencies too (docs/AGENCY.md §1), whichever side changes: the guard
-- from 0012 now also covers agency_members.
CREATE OR REPLACE FUNCTION app_staff_not_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME IN ('memberships', 'agency_members') THEN
    IF EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND platform_role IS NOT NULL) THEN
      RAISE EXCEPTION 'Staff accounts can''t belong to a business or an agency' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.platform_role IS NOT NULL AND (
    EXISTS (SELECT 1 FROM memberships WHERE user_id = NEW.id)
    OR EXISTS (SELECT 1 FROM agency_members WHERE user_id = NEW.id)
  ) THEN
    RAISE EXCEPTION 'Accounts that belong to a business or an agency can''t be staff' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER agency_members_staff_guard BEFORE INSERT OR UPDATE OF user_id ON agency_members
  FOR EACH ROW EXECUTE FUNCTION app_staff_not_member();
