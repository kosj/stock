-- Requires 20260816_price_daily.sql. No destructive replacement outside this RPC.
CREATE TABLE IF NOT EXISTS public.price_snapshot_versions (
  ticker text NOT NULL,
  revision bigint NOT NULL,
  rows jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, revision)
);
ALTER TABLE public.price_snapshot_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.price_snapshot_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.price_snapshot_versions TO service_role;

CREATE OR REPLACE FUNCTION public.read_price_snapshot(p_ticker text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'revision', COALESCE((SELECT max(revision) FROM price_snapshot_versions WHERE ticker=p_ticker),0),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'date',date,'open',open,'high',high,'low',low,'close',close,'volume',volume) ORDER BY date)
      FROM price_daily WHERE ticker=p_ticker),'[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.publish_price_snapshot(
  p_ticker text, p_expected_revision bigint, p_rows jsonb, p_reason text
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_revision bigint; v_old jsonb;
BEGIN
  IF p_ticker IS NULL OR length(p_ticker) NOT BETWEEN 1 AND 40
     OR p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 20000
     OR p_reason NOT IN ('seed','append','resync') THEN
    RAISE EXCEPTION 'invalid snapshot';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('price:'||p_ticker,0));
  SELECT COALESCE(max(revision),0) INTO v_revision FROM price_snapshot_versions WHERE ticker=p_ticker;
  IF p_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION 'snapshot revision conflict';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(date date, close numeric)
             WHERE date IS NULL OR close IS NULL OR close <= 0 OR close::text IN ('NaN','Infinity','-Infinity'))
     OR (SELECT count(DISTINCT r.date) FROM jsonb_to_recordset(p_rows) AS r(date date)) <> jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'invalid snapshot rows';
  END IF;
  -- Keep the pre-migration snapshot as revision zero for reproducibility.
  IF v_revision=0 THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('date',date,'open',open,'high',high,
      'low',low,'close',close,'volume',volume) ORDER BY date),'[]'::jsonb)
      INTO v_old FROM price_daily WHERE ticker=p_ticker;
    INSERT INTO price_snapshot_versions(ticker,revision,rows,reason)
      VALUES(p_ticker,0,v_old,'legacy') ON CONFLICT DO NOTHING;
  END IF;
  DELETE FROM price_daily WHERE ticker=p_ticker;
  INSERT INTO price_daily(ticker,date,open,high,low,close,volume)
    SELECT p_ticker,r.date,r.open,r.high,r.low,r.close,r.volume
    FROM jsonb_to_recordset(p_rows) AS r(date date,open numeric,high numeric,low numeric,close numeric,volume numeric);
  INSERT INTO price_snapshot_versions(ticker,revision,rows,reason)
    VALUES(p_ticker,v_revision+1,p_rows,p_reason);
  RETURN v_revision+1;
END $$;
REVOKE ALL ON FUNCTION public.read_price_snapshot(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_price_snapshot(text,bigint,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_price_snapshot(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_price_snapshot(text,bigint,jsonb,text) TO service_role;
