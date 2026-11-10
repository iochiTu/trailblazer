-- Business page: services/products and notices are tenant-isolated like other assistant tables
-- (same policy as 0001_rls.sql). Privileges for traiblazer_app come from the default privileges set in 0001.
ALTER TABLE "catalog_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "catalog_items"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "notices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notices"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- Photos of services and products are public, like the rest of the page.
CREATE OR REPLACE FUNCTION app_get_public_asset(p_id uuid)
RETURNS TABLE (content_type text, bytes bytea, sha256 text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.content_type, a.bytes, a.sha256
  FROM assets a
  WHERE a.id = p_id AND a.kind IN ('avatar', 'knowledge_image', 'catalog_image')
  LIMIT 1
$$;
--> statement-breakpoint
-- Friendly page links (<chat-domain>/<slug>) resolve to the assistant's current public key without
-- cross-tenant reads by the app role, like app_resolve_bot_key.
CREATE OR REPLACE FUNCTION app_resolve_page_slug(p_slug text)
RETURNS TABLE (public_key text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT k.public_key
  FROM bots b
  JOIN bot_keys k ON k.bot_id = b.id AND k.tenant_id = b.tenant_id AND k.revoked_at IS NULL
  WHERE b.page_slug = p_slug
  ORDER BY k.created_at DESC
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_resolve_page_slug(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_resolve_page_slug(text) TO traiblazer_app;
