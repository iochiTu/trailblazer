-- Business pages search engines may list, for the sitemap (<chat-domain>/sitemap.xml): read without
-- cross-tenant access by the app role, like app_resolve_page_slug. A page is listed when the business
-- is active and not a prospect demo, the assistant is live with its web version on, and the owner
-- hasn't kept it unlisted (the same rule as the page's robots meta tag in apps/api/src/page/render.ts).
CREATE OR REPLACE FUNCTION app_listed_pages(p_limit integer)
RETURNS TABLE (page_slug text, public_key text, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.page_slug, k.public_key, b.updated_at
  FROM bots b
  JOIN tenants t ON t.id = b.tenant_id
  JOIN LATERAL (
    SELECT bk.public_key
    FROM bot_keys bk
    WHERE bk.bot_id = b.id AND bk.tenant_id = b.tenant_id AND bk.revoked_at IS NULL
    ORDER BY bk.created_at DESC
    LIMIT 1
  ) k ON true
  WHERE t.status = 'active'
    AND t.kind <> 'demo'
    AND b.status = 'active'
    AND b.hosted_page_enabled
    AND (b.settings #>> '{page,listed}') IS DISTINCT FROM 'false'
  ORDER BY b.updated_at DESC
  LIMIT least(greatest(p_limit, 0), 50000)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_listed_pages(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_listed_pages(integer) TO traiblazer_app;
