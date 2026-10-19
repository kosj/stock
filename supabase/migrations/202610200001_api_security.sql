-- Shared authenticated analysis quota: one bounded row per user/scope, 120 ticker units/minute.
BEGIN;
-- Replace the legacy email-based bootstrap only where that optional profile schema exists.
-- Existing users/profiles/roles are intentionally preserved. Administrators assign roles.
DO $migration$
BEGIN
  IF to_regclass('public.user_profiles') IS NOT NULL THEN
    EXECUTE $definition$
      CREATE OR REPLACE FUNCTION public.handle_new_user()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
      BEGIN
        INSERT INTO public.user_profiles(id, email, full_name, role)
        VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', 'pending')
        ON CONFLICT (id) DO NOTHING;
        RETURN NEW;
      END;
      $function$;
    $definition$;
  END IF;
END;
$migration$;

CREATE TABLE IF NOT EXISTS public.api_request_quotas (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope = 'analysis'),
  window_started_at timestamptz NOT NULL,
  used integer NOT NULL CHECK (used BETWEEN 0 AND 120),
  PRIMARY KEY (user_id, scope)
);
ALTER TABLE public.api_request_quotas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_request_quotas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.api_request_quotas TO service_role;

CREATE OR REPLACE FUNCTION public.consume_api_quota(p_user_id uuid, p_scope text, p_cost integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_used integer; v_now timestamptz := clock_timestamp();
BEGIN
  IF p_user_id IS NULL OR p_scope IS DISTINCT FROM 'analysis' OR p_cost IS NULL OR p_cost < 1 OR p_cost > 20 THEN
    RAISE EXCEPTION 'invalid quota request';
  END IF;
  INSERT INTO public.api_request_quotas AS q(user_id, scope, window_started_at, used)
    VALUES (p_user_id, p_scope, v_now, p_cost)
  ON CONFLICT (user_id, scope) DO UPDATE SET
    window_started_at = CASE WHEN q.window_started_at <= v_now - interval '60 seconds' THEN v_now ELSE q.window_started_at END,
    used = CASE WHEN q.window_started_at <= v_now - interval '60 seconds' THEN p_cost ELSE q.used + p_cost END
  WHERE q.window_started_at <= v_now - interval '60 seconds' OR q.used + p_cost <= 120
  RETURNING used INTO v_used;
  RETURN v_used IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_api_quota(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_quota(uuid, text, integer) TO service_role;
COMMIT;
