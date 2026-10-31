BEGIN;
-- Never backfill historical account returns from book costs or assume cash flows.
CREATE TABLE public.mock_equity_snapshots (
 user_id uuid NOT NULL REFERENCES public.mock_accounts(user_id) ON DELETE CASCADE,
 account_epoch bigint NOT NULL, observed_at timestamptz NOT NULL,
 cash double precision NOT NULL, equity double precision,
 complete boolean NOT NULL, marks jsonb NOT NULL,
 benchmark_price double precision, benchmark_observed_at timestamptz,
 benchmark_aligned boolean NOT NULL DEFAULT false,
 context jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(user_id,account_epoch,observed_at)
);
ALTER TABLE public.mock_equity_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mock_equity_snapshots FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.mock_equity_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.record_mock_equity_snapshot(p_user uuid,p_owner uuid,p_epoch bigint,
 p_observed_at timestamptz,p_marks jsonb,p_benchmark jsonb DEFAULT NULL,p_context jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE a mock_accounts%ROWTYPE; n integer; marked integer; ok boolean; value double precision;
 lo timestamptz; hi timestamptz; bp double precision; bt timestamptz; aligned boolean:=false;
BEGIN
 IF p_observed_at IS NULL OR p_observed_at<clock_timestamp()-interval '2 minutes'
 OR p_observed_at>clock_timestamp()+interval '1 minute' OR jsonb_typeof(p_marks) IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_marks)>200 THEN RAISE EXCEPTION 'invalid_observation'; END IF;
 PERFORM 1 FROM auto_trade_leases WHERE user_id=p_user AND owner=p_owner AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'account_busy_or_lease_expired'; END IF;
 SELECT * INTO a FROM mock_accounts WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND OR a.account_epoch IS DISTINCT FROM p_epoch THEN RAISE EXCEPTION 'stale_account_epoch'; END IF;
 SELECT count(*) INTO n FROM mock_positions WHERE user_id=p_user;
 IF (SELECT count(DISTINCT m->>'ticker') FROM jsonb_array_elements(p_marks) m)<>jsonb_array_length(p_marks)
 OR jsonb_array_length(p_marks)<>n OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(p_marks) m WHERE NOT EXISTS(
    SELECT 1 FROM mock_positions p WHERE p.user_id=p_user AND p.ticker=m->>'ticker'
      AND p.quantity=(m->>'quantity')::integer)) THEN RAISE EXCEPTION 'observation_inventory_mismatch'; END IF;
 SELECT count(*),coalesce(bool_and(price>0 AND price<'Infinity'::float AND traded_at IS NOT NULL
   AND traded_at>=p_observed_at-interval '10 minutes' AND traded_at<=p_observed_at+interval '1 minute'),true),
   coalesce(sum(quantity*price),0),min(traded_at),max(traded_at)
 INTO marked,ok,value,lo,hi FROM jsonb_to_recordset(p_marks) AS m(ticker text,quantity integer,price float,traded_at timestamptz);
 -- NULL prices/timestamps must never turn a failed valuation into a 0% return.
 ok:=ok AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_marks) m
   WHERE m->>'price' IS NULL OR m->>'traded_at' IS NULL);
 IF p_benchmark IS NOT NULL THEN
  bp:=(p_benchmark->>'price')::float; bt:=(p_benchmark->>'traded_at')::timestamptz;
  aligned:=coalesce(ok AND bp>0 AND bp<'Infinity'::float AND bt>=p_observed_at-interval '10 minutes'
   AND bt<=p_observed_at+interval '1 minute' AND (n=0 OR (bt BETWEEN hi-interval '60 seconds' AND lo+interval '60 seconds')),false);
 END IF;
 INSERT INTO mock_equity_snapshots VALUES(p_user,p_epoch,p_observed_at,a.cash,
   CASE WHEN ok THEN a.cash+value ELSE NULL END,ok,p_marks,
   CASE WHEN aligned THEN bp ELSE NULL END,bt,aligned,coalesce(p_context,'{}'::jsonb))
 ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.mock_performance_history(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT jsonb_build_object(
  'first',(SELECT to_jsonb(s)-'marks'-'user_id' FROM mock_equity_snapshots s WHERE s.user_id=a.user_id
    AND s.account_epoch=a.account_epoch AND s.complete ORDER BY observed_at LIMIT 1),
  'last',(SELECT to_jsonb(s)-'marks'-'user_id' FROM mock_equity_snapshots s WHERE s.user_id=a.user_id
    AND s.account_epoch=a.account_epoch ORDER BY observed_at DESC LIMIT 1),
  'samples',(SELECT count(*) FROM mock_equity_snapshots s WHERE s.user_id=a.user_id AND s.account_epoch=a.account_epoch AND s.complete),
  'flows',coalesce((SELECT jsonb_agg(jsonb_build_object('amount',l.amount,'created_at',l.created_at))
    FROM mock_cash_ledger l WHERE l.user_id=a.user_id AND l.account_epoch=a.account_epoch AND l.kind='adjustment'),'[]'::jsonb))
 FROM mock_accounts a WHERE a.user_id=p_user;
$$;
REVOKE ALL ON FUNCTION public.record_mock_equity_snapshot(uuid,uuid,bigint,timestamptz,jsonb,jsonb,jsonb),
 public.mock_performance_history(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_mock_equity_snapshot(uuid,uuid,bigint,timestamptz,jsonb,jsonb,jsonb),
 public.mock_performance_history(uuid) TO service_role;

-- News/model inputs are server-written. No user rows, scores or history change.
DO $$ DECLARE seq text;
BEGIN
 IF to_regclass('public.news_sentiment') IS NOT NULL THEN
  ALTER TABLE public.news_sentiment ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.news_sentiment FROM PUBLIC,anon,authenticated;
  GRANT SELECT,INSERT,UPDATE,DELETE ON public.news_sentiment TO service_role;
  IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.news_sentiment'::regclass
     AND attname='id' AND attnum>0 AND NOT attisdropped) THEN
   SELECT pg_get_serial_sequence('public.news_sentiment','id') INTO seq;
  END IF;
  IF seq IS NOT NULL THEN
   EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC,anon,authenticated',seq);
   EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE %s TO service_role',seq);
  END IF;
 END IF;
END $$;
COMMIT;
