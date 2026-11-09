-- Visitor images: tenant-isolated like other tables (same policy as 0001_rls.sql). There is no
-- public read path: only the business's own staff can view them, through the authenticated API.

ALTER TABLE "message_attachments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "message_attachments"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
