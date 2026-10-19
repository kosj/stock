-- Requires trading_safety and mock_order_guards; service-role RPCs only.
BEGIN;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS account_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS performance_baseline FLOAT;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS baseline_at TIMESTAMPTZ;
-- Historical cash adjustments/costs were not recorded. Start a disclosed accounting
-- baseline at book value; never manufacture an initial deposit or historical fees.
UPDATE mock_accounts a SET performance_baseline = a.cash + COALESCE((SELECT sum(quantity*avg_price) FROM mock_positions p WHERE p.user_id=a.user_id),0), baseline_at=clock_timestamp()
WHERE performance_baseline IS NULL;
CREATE TABLE IF NOT EXISTS mock_cash_ledger (
 id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL, account_epoch BIGINT NOT NULL,
 amount FLOAT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('adjustment','reset')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE mock_cash_ledger ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS mock_cash_ledger_user_epoch ON mock_cash_ledger(user_id,account_epoch);
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS reference_price FLOAT;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS execution_cost FLOAT;

CREATE OR REPLACE FUNCTION lock_mock_account(p_user_id UUID, p_owner UUID, p_epoch BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e BIGINT;
BEGIN
 -- Lease row first, then account everywhere. Locking the row also fences expiry
 -- takeover until this transaction commits.
 PERFORM 1 FROM auto_trade_leases WHERE user_id=p_user_id AND owner=p_owner AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'account_busy_or_lease_expired'; END IF;
 INSERT INTO mock_accounts(user_id,cash,performance_baseline,baseline_at)
 VALUES(p_user_id,10000000,10000000,transaction_timestamp()) ON CONFLICT(user_id) DO NOTHING;
 SELECT account_epoch INTO e FROM mock_accounts WHERE user_id=p_user_id FOR UPDATE;
 IF p_epoch IS NULL OR e<>p_epoch THEN RAISE EXCEPTION 'stale_account_epoch'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION execute_mock_order(p_user_id UUID,p_ticker VARCHAR,p_name VARCHAR,
 p_quantity INTEGER,p_price FLOAT,p_client_order_id TEXT,p_side TEXT,p_account_epoch BIGINT,
 p_execution_owner UUID,p_reference_price FLOAT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r JSONB; k TEXT; t mock_trades%ROWTYPE;
BEGIN
 PERFORM lock_mock_account(p_user_id,p_execution_owner,p_account_epoch);
 IF p_client_order_id IS NULL OR length(p_client_order_id) NOT BETWEEN 1 AND 180
 OR p_quantity IS NULL OR p_quantity<=0 OR p_price IS NULL OR NOT(p_price>0 AND p_price<'Infinity'::FLOAT)
 OR p_side IS NULL OR p_side NOT IN ('BUY','SELL') OR p_ticker IS NULL OR p_ticker !~ '^[0-9]{6}$'
 OR p_name IS NULL OR length(p_name) NOT BETWEEN 1 AND 100 OR p_reference_price IS NULL
 OR NOT(p_reference_price>0 AND p_reference_price<'Infinity'::FLOAT) THEN RAISE EXCEPTION 'invalid_order'; END IF;
 k:=p_account_epoch::TEXT||':'||p_client_order_id;
 SELECT * INTO t FROM mock_trades WHERE user_id=p_user_id AND client_order_id=k;
 IF FOUND THEN
   IF t.ticker<>p_ticker OR t.trade_type<>p_side OR t.quantity<>p_quantity THEN RAISE EXCEPTION 'order_key_conflict'; END IF;
   RETURN jsonb_build_object('ok',true,'duplicate',true,'price',t.price,'quantity',t.quantity,'total_amount',t.total_amount,'execution_cost',t.execution_cost);
 END IF;
 IF p_side='BUY' THEN r:=execute_mock_buy(p_user_id,p_ticker,p_name,p_quantity,p_price,k);
 ELSE r:=execute_mock_sell(p_user_id,p_ticker,p_name,p_quantity,p_price,k); END IF;
 UPDATE mock_trades SET reference_price=p_reference_price,
 execution_cost=round(abs(price-p_reference_price)*quantity*100)/100
 WHERE user_id=p_user_id AND client_order_id=k RETURNING * INTO t;
 RETURN r||jsonb_build_object('quantity',t.quantity,'execution_cost',t.execution_cost);
END; $$;

CREATE OR REPLACE FUNCTION update_mock_account(p_user_id UUID,p_owner UUID,p_epoch BIGINT,
 p_cash FLOAT,p_set_cash BOOLEAN,p_capital FLOAT,p_set_capital BOOLEAN,p_reset BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a mock_accounts%ROWTYPE;
BEGIN
 PERFORM lock_mock_account(p_user_id,p_owner,p_epoch);
 SELECT * INTO a FROM mock_accounts WHERE user_id=p_user_id;
 IF p_reset THEN
  DELETE FROM mock_positions WHERE user_id=p_user_id;
  DELETE FROM mock_trades WHERE user_id=p_user_id;
  DELETE FROM mock_auto_trade_logs WHERE user_id=p_user_id;
  UPDATE mock_accounts SET cash=10000000,auto_trade_capital=NULL,account_epoch=account_epoch+1,
   performance_baseline=10000000,baseline_at=clock_timestamp(),updated_at=clock_timestamp() WHERE user_id=p_user_id;
  INSERT INTO mock_cash_ledger(user_id,account_epoch,amount,kind) VALUES(p_user_id,p_epoch+1,10000000,'reset');
 ELSE
  IF p_set_cash THEN
   IF p_cash IS NULL OR NOT(p_cash>=0 AND p_cash<=1000000000) THEN RAISE EXCEPTION 'invalid_cash'; END IF;
   INSERT INTO mock_cash_ledger(user_id,account_epoch,amount,kind) VALUES(p_user_id,p_epoch,p_cash-a.cash,'adjustment');
  END IF;
  IF p_set_capital AND p_capital IS NOT NULL AND NOT(p_capital>=0 AND p_capital<=1000000000) THEN RAISE EXCEPTION 'invalid_capital'; END IF;
  UPDATE mock_accounts SET cash=CASE WHEN p_set_cash THEN p_cash ELSE cash END,
   auto_trade_capital=CASE WHEN p_set_capital THEN p_capital ELSE auto_trade_capital END,
   updated_at=clock_timestamp() WHERE user_id=p_user_id;
 END IF;
 RETURN jsonb_build_object('ok',true,'account_epoch',CASE WHEN p_reset THEN p_epoch+1 ELSE p_epoch END);
END; $$;

-- Reads a consistent ledger/book snapshot in one statement. Live prices are added by API.
CREATE OR REPLACE FUNCTION mock_account_snapshot(p_user_id UUID) RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT to_jsonb(a)||jsonb_build_object(
  'positions',COALESCE((SELECT jsonb_agg(p) FROM mock_positions p WHERE p.user_id=a.user_id),'[]'::jsonb),
  'net_cash_adjustments',COALESCE((SELECT sum(amount) FROM mock_cash_ledger l WHERE l.user_id=a.user_id AND l.account_epoch=a.account_epoch AND kind='adjustment'),0),
  'realized_pnl',COALESCE((SELECT sum(realized_pnl) FROM mock_trades t WHERE t.user_id=a.user_id AND t.created_at>=a.baseline_at),0),
  'recorded_costs',COALESCE((SELECT sum(execution_cost) FROM mock_trades t WHERE t.user_id=a.user_id AND t.created_at>=a.baseline_at),0),
  'cost_history_complete',NOT EXISTS(SELECT 1 FROM mock_trades t WHERE t.user_id=a.user_id AND t.created_at>=a.baseline_at AND execution_cost IS NULL)
 ) FROM mock_accounts a WHERE user_id=p_user_id;
$$;
REVOKE ALL ON FUNCTION execute_mock_buy(UUID,VARCHAR,VARCHAR,INTEGER,FLOAT,TEXT),execute_mock_sell(UUID,VARCHAR,VARCHAR,INTEGER,FLOAT,TEXT) FROM service_role;
REVOKE ALL ON FUNCTION lock_mock_account(UUID,UUID,BIGINT),execute_mock_order(UUID,VARCHAR,VARCHAR,INTEGER,FLOAT,TEXT,TEXT,BIGINT,UUID,FLOAT),update_mock_account(UUID,UUID,BIGINT,FLOAT,BOOLEAN,FLOAT,BOOLEAN,BOOLEAN),mock_account_snapshot(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION execute_mock_order(UUID,VARCHAR,VARCHAR,INTEGER,FLOAT,TEXT,TEXT,BIGINT,UUID,FLOAT),update_mock_account(UUID,UUID,BIGINT,FLOAT,BOOLEAN,FLOAT,BOOLEAN,BOOLEAN),mock_account_snapshot(UUID) TO service_role;
COMMIT;
