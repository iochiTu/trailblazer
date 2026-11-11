-- Uploaded source files: tenant-isolated like other assistant tables (same policy as 0001_rls.sql).
-- Privileges for traiblazer_app come from the default privileges set in 0001. Never public: there
-- is no function that reads them without a tenant (unlike app_get_public_asset).
ALTER TABLE "source_files" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "source_files"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
