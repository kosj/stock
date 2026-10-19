-- Apply with service/admin privileges BEFORE deploying the application.
BEGIN;
CREATE TABLE IF NOT EXISTS auto_trade_leases (
  user_id UUID PRIMARY KEY, owner UUID NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE auto_trade_leases ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION acquire_auto_trade_lease(p_user_id UUID, p_owner UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE acquired BOOLEAN;
BEGIN
  INSERT INTO auto_trade_leases VALUES(p_user_id, p_owner, clock_timestamp() + INTERVAL '120 seconds')
  ON CONFLICT(user_id) DO UPDATE SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
    WHERE auto_trade_leases.expires_at < clock_timestamp()
  RETURNING true INTO acquired;
  RETURN COALESCE(acquired, false);
END; $$;
CREATE OR REPLACE FUNCTION release_auto_trade_lease(p_user_id UUID, p_owner UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM auto_trade_leases WHERE user_id = p_user_id AND owner = p_owner;
$$;
REVOKE ALL ON FUNCTION acquire_auto_trade_lease(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_auto_trade_lease(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION acquire_auto_trade_lease(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION release_auto_trade_lease(UUID, UUID) TO service_role;

CREATE TABLE IF NOT EXISTS recommendation_batches (
  run_date DATE PRIMARY KEY,
  data_as_of DATE NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  model_version TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK(row_count >= 20)
);
ALTER TABLE recommendation_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE prophet_recommendations ADD COLUMN IF NOT EXISTS excess_return FLOAT;
ALTER TABLE prophet_recommendations ADD COLUMN IF NOT EXISTS sentiment_score FLOAT;
ALTER TABLE prophet_recommendations ADD COLUMN IF NOT EXISTS sentiment_3d_ma FLOAT;

-- One transaction: old rows remain visible until the new COMPLETE batch commits.
-- No automatic legacy backfill: old incomplete/unverified batches must not trade.
CREATE OR REPLACE FUNCTION publish_recommendations(
  p_run_date DATE, p_data_as_of DATE, p_model_version TEXT, p_rows JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INTEGER; ranks INTEGER[];
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) < 20 THEN
    RAISE EXCEPTION 'incomplete_recommendation_batch';
  END IF;
  IF p_data_as_of > p_run_date OR p_run_date - p_data_as_of > 4 THEN
    RAISE EXCEPTION 'stale_or_future_source_data';
  END IF;
  SELECT array_agg(rank ORDER BY rank) FILTER (WHERE rank IS NOT NULL), count(*)
    INTO ranks, n FROM jsonb_populate_recordset(NULL::prophet_recommendations, p_rows);
  IF ranks IS DISTINCT FROM ARRAY(SELECT generate_series(1, 20)) OR EXISTS (
    SELECT 1 FROM jsonb_populate_recordset(NULL::prophet_recommendations, p_rows) r
    WHERE r.run_date IS DISTINCT FROM p_run_date OR r.ticker IS NULL
      OR r.current_price IS NULL OR NOT (r.current_price > 0 AND r.current_price < 'Infinity'::FLOAT)
  ) THEN RAISE EXCEPTION 'invalid_recommendation_batch'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('recommendation-publication'));
  DELETE FROM prophet_recommendations WHERE run_date = p_run_date;
  INSERT INTO prophet_recommendations (
    run_date, rank, ticker, name, market, sector, current_price,
    predicted_return_7d, predicted_return_30d, bull_return_30d, base_return_30d,
    bear_return_30d, recommendation, r_squared, trend_direction, accuracy_json,
    excess_return, sentiment_score, sentiment_3d_ma
  ) SELECT run_date, rank, ticker, name, market, sector, current_price,
    predicted_return_7d, predicted_return_30d, bull_return_30d, base_return_30d,
    bear_return_30d, recommendation, r_squared, trend_direction, accuracy_json,
    excess_return, sentiment_score, sentiment_3d_ma
    FROM jsonb_populate_recordset(NULL::prophet_recommendations, p_rows);
  INSERT INTO recommendation_batches(run_date, data_as_of, model_version, row_count)
    VALUES(p_run_date, p_data_as_of, p_model_version, n)
  ON CONFLICT(run_date) DO UPDATE SET data_as_of = EXCLUDED.data_as_of,
    model_version = EXCLUDED.model_version, row_count = EXCLUDED.row_count,
    completed_at = clock_timestamp();
END; $$;
REVOKE ALL ON FUNCTION publish_recommendations(DATE, DATE, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION publish_recommendations(DATE, DATE, TEXT, JSONB) TO service_role;
COMMIT;
