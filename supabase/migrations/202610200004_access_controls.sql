-- Application data is accessed exclusively through authenticated Next server APIs.
-- Never run schema.sql after migrations: it contains historical RLS-disable DDL.
BEGIN;
DO $$
DECLARE t text; seq text; f record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'portfolios','positions','watchlist','price_alerts','push_subscriptions',
    'user_profiles','user_broker_configs','mock_accounts','mock_positions','mock_trades',
    'mock_auto_trade_logs','mock_cash_ledger','auto_trade_leases',
    'quote_cache','prophet_recommendations','recommendation_batches',
    'sector_etfs','etf_daily_prices','etf_universe','krx_daily','etf_pick_history',
    'price_daily','price_snapshot_versions','api_request_quotas'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
    FOR seq IN SELECT pg_get_serial_sequence(format('public.%I',t), a.attname)
      FROM pg_attribute a WHERE a.attrelid = to_regclass('public.'||t)
      AND a.attnum > 0 AND NOT a.attisdropped LOOP
      IF seq IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', seq);
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', seq);
      END IF;
    END LOOP;
  END LOOP;
  -- Covers old overloads as well as the currently deployed signatures.
  FOR f IN SELECT p.oid::regprocedure AS signature,p.proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    AND p.proname = ANY(ARRAY['insert_position_owned','update_position_owned',
      'delete_position_owned','execute_mock_buy','execute_mock_sell',
      'acquire_auto_trade_lease','release_auto_trade_lease','publish_recommendations'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
    IF f.proname NOT IN ('execute_mock_buy','execute_mock_sell') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
    ELSE
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role',f.signature);
    END IF;
  END LOOP;
END $$;
COMMIT;
