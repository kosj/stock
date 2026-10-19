SELECT jsonb_build_object(
 'columns',(SELECT jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',udt_name,'nullable',is_nullable)) FROM information_schema.columns WHERE table_schema='public' AND (
   table_name IN ('etf_pick_history','price_daily','auto_trade_leases','recommendation_batches')
   OR (table_name='price_alerts' AND column_name='user_id')
   OR (table_name='mock_trades' AND column_name='realized_pnl')
   OR (table_name='prophet_recommendations' AND column_name IN ('excess_return','sentiment_score','sentiment_3d_ma')))),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef)) FROM pg_indexes WHERE schemaname='public' AND tablename IN ('etf_pick_history','price_alerts','price_daily','mock_trades','auto_trade_leases','recommendation_batches')),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid))) FROM pg_constraint c WHERE c.contype IN ('p','u','c','f','x') AND c.conrelid IN ('public.etf_pick_history'::regclass,'public.price_daily'::regclass,'public.recommendation_batches'::regclass,'public.auto_trade_leases'::regclass)),
 'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('execute_mock_buy','execute_mock_sell','publish_recommendations','acquire_auto_trade_lease','release_auto_trade_lease'))
) AS evidence;
