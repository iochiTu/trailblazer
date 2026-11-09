-- Business photos: tenant-isolated like other knowledge tables (same policy as 0001_rls.sql).
ALTER TABLE "knowledge_images" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "knowledge_images"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- Knowledge photos are shown to visitors, so they are public like avatars (by unguessable id).
-- Visitors' own chat images live in message_attachments and are never served here.
CREATE OR REPLACE FUNCTION app_get_public_asset(p_id uuid)
RETURNS TABLE (content_type text, bytes bytea, sha256 text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.content_type, a.bytes, a.sha256
  FROM assets a
  WHERE a.id = p_id AND a.kind IN ('avatar', 'knowledge_image')
  LIMIT 1
$$;
--> statement-breakpoint
-- Photo allowance per assistant for the built-in plans (operators can change it).
UPDATE "plans" SET "knowledge_images" = CASE "id"
  WHEN 'trial' THEN 20
  WHEN 'local' THEN 50
  WHEN 'local_plus' THEN 100
  WHEN 'professional' THEN 200
  WHEN 'business' THEN 500
  ELSE "knowledge_images" END;
