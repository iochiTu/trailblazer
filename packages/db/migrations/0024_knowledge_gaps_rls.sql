-- Knowledge gaps: tenant-isolated like other assistant tables (same policy as 0001_rls.sql).
-- Privileges for traiblazer_app come from the default privileges set in 0001.
ALTER TABLE "knowledge_gaps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "knowledge_gaps"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
