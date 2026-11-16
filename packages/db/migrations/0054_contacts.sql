CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"author_user_id" uuid,
	"subject" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"error" text,
	"bot_id" uuid,
	"outbound_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text,
	"phone" text,
	"email" text,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_messages_contact_idx" ON "contact_messages" USING btree ("tenant_id","contact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_phone_uq" ON "contacts" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "contacts_activity_idx" ON "contacts" USING btree ("tenant_id","last_activity_at");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_contact_idx" ON "leads" USING btree ("tenant_id","contact_id");--> statement-breakpoint
-- Tenant isolation, like the other tenant-owned tables (same policy as 0001_rls.sql).
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "contacts"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "contact_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "contact_messages"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- Contacts for the requests and text threads that exist already. A phone number is read the way
-- toE164 (@traiblazer/telephony) reads it: ten digits are a Canadian or US number. The owner's own
-- tests (channel "playground") are left out.
CREATE TEMPORARY TABLE contacts_backfill ON COMMIT DROP AS
SELECT l.id, l.tenant_id, nullif(btrim(l.name), '') AS name, nullif(lower(btrim(l.email)), '') AS email,
       CASE
         WHEN btrim(l.phone) LIKE '+%' AND length(d.digits) BETWEEN 8 AND 15 THEN '+' || d.digits
         WHEN length(d.digits) = 10 THEN '+1' || d.digits
         WHEN length(d.digits) = 11 AND d.digits LIKE '1%' THEN '+' || d.digits
       END AS phone,
       l.created_at
FROM leads l
CROSS JOIN LATERAL (SELECT regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') AS digits) d
WHERE l.channel <> 'playground';
--> statement-breakpoint
-- One contact per phone number, named as in its latest request.
INSERT INTO contacts (tenant_id, phone, name, email, last_activity_at, created_at)
SELECT DISTINCT ON (tenant_id, phone) tenant_id, phone, name, email, created_at, created_at
FROM contacts_backfill
WHERE phone IS NOT NULL
ORDER BY tenant_id, phone, created_at DESC;
--> statement-breakpoint
-- People who texted or called the assistant's number without leaving a request.
INSERT INTO contacts (tenant_id, phone, last_activity_at, created_at)
SELECT c.tenant_id, c.visitor_id, max(c.last_message_at), min(c.created_at)
FROM conversations c
WHERE c.channel = 'sms' AND c.visitor_id ~ '^\+\d{8,15}$'
GROUP BY c.tenant_id, c.visitor_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- One contact per email address not already known through a phone number.
INSERT INTO contacts (tenant_id, email, name, last_activity_at, created_at)
SELECT DISTINCT ON (b.tenant_id, b.email) b.tenant_id, b.email, b.name, b.created_at, b.created_at
FROM contacts_backfill b
WHERE b.phone IS NULL AND b.email IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.tenant_id = b.tenant_id AND c.email = b.email)
ORDER BY b.tenant_id, b.email, b.created_at DESC;
--> statement-breakpoint
-- A request with only a name is its own contact (the request's id is reused, to link them below).
INSERT INTO contacts (id, tenant_id, name, last_activity_at, created_at)
SELECT id, tenant_id, name, created_at, created_at
FROM contacts_backfill
WHERE phone IS NULL AND email IS NULL AND name IS NOT NULL;
--> statement-breakpoint
UPDATE leads l
SET contact_id = coalesce(
  (SELECT c.id FROM contacts c WHERE c.tenant_id = b.tenant_id AND c.phone = b.phone),
  (SELECT c.id FROM contacts c WHERE c.tenant_id = b.tenant_id AND c.email = b.email
   ORDER BY c.created_at LIMIT 1),
  (SELECT c.id FROM contacts c WHERE c.id = b.id))
FROM contacts_backfill b
WHERE b.id = l.id;
--> statement-breakpoint
UPDATE contacts c
SET last_activity_at = greatest(
  c.last_activity_at,
  coalesce((SELECT max(l.created_at) FROM leads l WHERE l.contact_id = c.id), c.last_activity_at));
