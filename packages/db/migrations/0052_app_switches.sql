ALTER TABLE "notification_prefs" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN "answering" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- A paused number answers neither texts nor calls: the resolver reports both as off, so the
-- telephony webhooks need no change and the business's own settings come back when it resumes.
CREATE OR REPLACE FUNCTION app_resolve_phone_number(p_e164 text)
RETURNS TABLE (id uuid, tenant_id uuid, bot_id uuid, sms_enabled boolean, call_mode text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT n.id, n.tenant_id, n.bot_id, n.sms_enabled AND n.answering,
    CASE WHEN n.answering THEN n.call_mode ELSE 'off' END
  FROM phone_numbers n
  WHERE n.e164 = p_e164
  LIMIT 1
$$;
