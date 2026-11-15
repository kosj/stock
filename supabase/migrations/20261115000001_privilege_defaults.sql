-- Forward-only privilege hardening (2026-11-15). Historical migration bodies are unchanged.
-- All application data is accessed by the Next.js server with the service role, so the
-- public anon key must never reach tables, sequences or SECURITY DEFINER functions.
-- 202610200004 only covered a fixed table list; this closes the gaps around it.
BEGIN;

-- 1. Objects created later by postgres (migrations, SQL editor) start server-only.
--    Supabase otherwise grants ALL to anon/authenticated on every new public table.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role;

-- 2. Public signup throttle: 5 attempts per client (HMAC of IP) and 30 overall per hour.
--    Self-signup creates confirmed accounts that wait for admin approval; without a limit a
--    script can flood the approval queue.
CREATE TABLE IF NOT EXISTS public.signup_attempts (
  bucket text PRIMARY KEY CHECK (bucket = 'global' OR bucket ~ '^ip:[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  used integer NOT NULL CHECK (used >= 0)
);
CREATE OR REPLACE FUNCTION public.consume_signup_quota(p_client text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_now timestamptz := clock_timestamp(); v_bucket text; v_limit integer; v_used integer;
BEGIN
  IF p_client IS NULL OR p_client !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid signup quota request';
  END IF;
  DELETE FROM public.signup_attempts
    WHERE bucket <> 'global' AND window_started_at < v_now - interval '1 day';
  -- Per-client first, so one noisy client cannot exhaust the shared budget.
  FOREACH v_bucket IN ARRAY ARRAY['ip:' || p_client, 'global'] LOOP
    v_limit := CASE WHEN v_bucket = 'global' THEN 30 ELSE 5 END;
    v_used := NULL;
    INSERT INTO public.signup_attempts AS s(bucket, window_started_at, used)
      VALUES (v_bucket, v_now, 1)
    ON CONFLICT (bucket) DO UPDATE SET
      window_started_at = CASE WHEN s.window_started_at <= v_now - interval '1 hour' THEN v_now ELSE s.window_started_at END,
      used = CASE WHEN s.window_started_at <= v_now - interval '1 hour' THEN 1 ELSE s.used + 1 END
    WHERE s.window_started_at <= v_now - interval '1 hour' OR s.used < v_limit
    RETURNING used INTO v_used;
    IF v_used IS NULL THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signup_attempts TO service_role;
REVOKE ALL ON FUNCTION public.consume_signup_quota(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_signup_quota(text) TO service_role;

DO $$
DECLARE r record;
BEGIN
  -- 3. Every existing public table, including ones created outside migrations
  --    (e.g. news_sentiment), gets RLS and loses anon/authenticated access.
  FOR r IN SELECT c.oid::regclass AS rel FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.rel);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', r.rel);
    -- The server role keeps (or gains) the same DML that 202610200004 grants.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO service_role', r.rel);
  END LOOP;
  FOR r IN SELECT c.oid::regclass AS rel, c.relkind FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm', 'S')
  LOOP
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, anon, authenticated', r.rel);
    IF r.relkind = 'S' THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', r.rel);
    END IF;
  END LOOP;

  -- 4. SECURITY DEFINER functions: callable by the server only, with a fixed search_path.
  --    Bodies are untouched; ALTER FUNCTION only adds the missing configuration.
  FOR r IN SELECT p.oid::regprocedure AS fn, p.proconfig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    -- Preserve exactly the server access that exists today (the legacy mock buy/sell
    -- bypasses stay revoked from service_role); only the public roles lose EXECUTE.
    IF has_function_privilege('service_role', r.fn, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.fn);
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.fn);
    IF NOT EXISTS (SELECT 1 FROM unnest(coalesce(r.proconfig, '{}'::text[])) AS c(setting)
                   WHERE c.setting LIKE 'search_path=%') THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.fn);
    END IF;
  END LOOP;

  -- 5. The legacy self-update policy covered every column (role, approved_at). The
  --    heartbeat now updates last_seen_at through the server, so the policy is unused.
  IF to_regclass('public.user_profiles') IS NOT NULL THEN
    DROP POLICY IF EXISTS users_update_own_last_seen ON public.user_profiles;
  END IF;
END $$;

COMMIT;
