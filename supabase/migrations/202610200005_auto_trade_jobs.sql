BEGIN;
CREATE TABLE IF NOT EXISTS public.auto_trade_jobs (
  run_date date NOT NULL, user_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','running','done','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0, owner uuid, lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(), result jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_date,user_id)
);
ALTER TABLE public.auto_trade_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_trade_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.auto_trade_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_auto_trade_jobs(p_date date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer;
BEGIN
  IF p_date IS DISTINCT FROM (now() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'Only current session may be enqueued'; END IF;
  INSERT INTO auto_trade_jobs(run_date,user_id)
    SELECT p_date,a.user_id FROM mock_accounts a JOIN auth.users u ON u.id=a.user_id
    WHERE a.trading_mode='mock' AND u.raw_app_meta_data->>'role' IN ('admin','user')
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT;
  -- No delayed execution of a previous day's recommendation/intent.
  UPDATE auto_trade_jobs SET status='cancelled',owner=NULL,lease_until=NULL,updated_at=now()
    WHERE run_date<p_date AND status IN ('pending','running');
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.claim_auto_trade_job(p_date date,p_owner uuid)
RETURNS SETOF public.auto_trade_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_owner IS NULL OR p_date IS DISTINCT FROM (now() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'Invalid job claim'; END IF;
  -- A role revoked since enqueue must not continue through the cron secret path.
  UPDATE auto_trade_jobs j SET status='cancelled',owner=NULL,lease_until=NULL,updated_at=now()
    WHERE j.run_date=p_date AND j.status IN ('pending','running')
    AND NOT EXISTS(SELECT 1 FROM auth.users u JOIN mock_accounts a ON a.user_id=u.id
      WHERE u.id=j.user_id AND a.trading_mode='mock'
      AND u.raw_app_meta_data->>'role' IN ('admin','user'));
  UPDATE auto_trade_jobs SET status='failed',owner=NULL,updated_at=now()
    WHERE run_date=p_date AND attempts>=3 AND status='running' AND lease_until<=now();
  RETURN QUERY WITH candidate AS (
    SELECT j.run_date,j.user_id FROM auto_trade_jobs j
    WHERE j.run_date=p_date AND j.attempts<3 AND j.available_at<=now()
      AND (j.status='pending' OR (j.status='running' AND j.lease_until<=now()))
    ORDER BY j.available_at,j.user_id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE auto_trade_jobs j SET status='running',attempts=j.attempts+1,
    owner=p_owner,lease_until=now()+interval '120 seconds',updated_at=now()
    FROM candidate c WHERE j.run_date=c.run_date AND j.user_id=c.user_id RETURNING j.*;
END $$;

CREATE OR REPLACE FUNCTION public.finish_auto_trade_job(p_date date,p_user uuid,p_owner uuid,p_result jsonb,p_success boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer;
BEGIN
  UPDATE auto_trade_jobs SET status=CASE WHEN p_success THEN 'done'
    WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,
    result=p_result,owner=NULL,lease_until=NULL,available_at=now()+interval '30 seconds',updated_at=now()
    WHERE run_date=p_date AND user_id=p_user AND status='running' AND owner=p_owner AND lease_until>now();
  GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_auto_trade_jobs(date),public.claim_auto_trade_job(date,uuid),
  public.finish_auto_trade_job(date,uuid,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_auto_trade_jobs(date),public.claim_auto_trade_job(date,uuid),
  public.finish_auto_trade_job(date,uuid,uuid,jsonb,boolean) TO service_role;
COMMIT;
