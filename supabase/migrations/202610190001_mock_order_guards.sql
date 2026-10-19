BEGIN;
CREATE OR REPLACE FUNCTION execute_mock_buy(
  p_user_id  UUID,
  p_ticker   VARCHAR,
  p_name     VARCHAR,
  p_quantity INTEGER,
  p_price    FLOAT,
  p_client_order_id TEXT DEFAULT NULL   -- 멱등성 키 (NULL = 수동거래, 멱등성 미적용)
) RETURNS JSONB AS $$
DECLARE
  v_total    FLOAT;
  v_cash     FLOAT;
  v_old_qty  INTEGER;
  v_old_avg  FLOAT;
  v_new_qty  INTEGER;
  v_new_avg  FLOAT;
  v_new_cash FLOAT;
  v_dup      mock_trades%ROWTYPE;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_price IS NULL
    OR NOT (p_price > 0 AND p_price < 'Infinity'::FLOAT) THEN
    RAISE EXCEPTION 'invalid_order';
  END IF;
  -- Account-first lock ordering for BOTH directions prevents buy/sell deadlocks.
  INSERT INTO mock_accounts(user_id, cash) VALUES(p_user_id, 10000000)
    ON CONFLICT(user_id) DO NOTHING;
  PERFORM 1 FROM mock_accounts WHERE user_id = p_user_id FOR UPDATE;
  -- 멱등성: 동일 client_order_id 기존 체결이 있으면 재실행 없이 기존 결과 반환
  IF p_client_order_id IS NOT NULL THEN
    SELECT * INTO v_dup FROM mock_trades
    WHERE user_id = p_user_id AND client_order_id = p_client_order_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true,
        'price', v_dup.price, 'quantity', v_dup.quantity, 'total_amount', v_dup.total_amount);
    END IF;
  END IF;

  v_total := ROUND(p_price * p_quantity * 100) / 100;

  -- 계좌 잠금 + 현금 확인 (없으면 자동 생성)
  INSERT INTO mock_accounts(user_id, cash)
  VALUES(p_user_id, 10000000)
  ON CONFLICT(user_id) DO NOTHING;

  SELECT cash INTO v_cash FROM mock_accounts WHERE user_id = p_user_id FOR UPDATE;

  IF v_cash < v_total THEN
    RAISE EXCEPTION 'insufficient_cash:%.0f:%.0f', v_cash, v_total;
  END IF;

  -- 기존 포지션 여부 확인 후 평균단가 재계산
  SELECT quantity, avg_price INTO v_old_qty, v_old_avg
  FROM mock_positions WHERE user_id = p_user_id AND ticker = p_ticker;

  IF FOUND THEN
    v_new_qty := v_old_qty + p_quantity;
    v_new_avg := ROUND(((v_old_avg * v_old_qty) + v_total) / v_new_qty * 100) / 100;
    UPDATE mock_positions
    SET quantity = v_new_qty, avg_price = v_new_avg, updated_at = NOW()
    WHERE user_id = p_user_id AND ticker = p_ticker;
  ELSE
    INSERT INTO mock_positions(user_id, ticker, name, quantity, avg_price)
    VALUES(p_user_id, p_ticker, p_name, p_quantity, p_price);
  END IF;

  -- 현금 차감
  v_new_cash := v_cash - v_total;
  UPDATE mock_accounts SET cash = v_new_cash, updated_at = NOW() WHERE user_id = p_user_id;

  -- 거래 기록 (멱등성 키 포함)
  INSERT INTO mock_trades(user_id, ticker, name, trade_type, quantity, price, total_amount, client_order_id)
  VALUES(p_user_id, p_ticker, p_name, 'BUY', p_quantity, p_price, v_total, p_client_order_id);

  RETURN jsonb_build_object(
    'ok', true, 'duplicate', false, 'price', p_price, 'total_amount', v_total, 'new_cash', ROUND(v_new_cash)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


CREATE OR REPLACE FUNCTION execute_mock_sell(
  p_user_id  UUID,
  p_ticker   VARCHAR,
  p_name     VARCHAR,
  p_quantity INTEGER,
  p_price    FLOAT,
  p_client_order_id TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_total    FLOAT;
  v_held_qty INTEGER;
  v_avg      FLOAT;
  v_realized FLOAT;
  v_new_qty  INTEGER;
  v_cash     FLOAT;
  v_new_cash FLOAT;
  v_dup      mock_trades%ROWTYPE;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_price IS NULL
    OR NOT (p_price > 0 AND p_price < 'Infinity'::FLOAT) THEN
    RAISE EXCEPTION 'invalid_order';
  END IF;
  -- Account-first lock ordering for BOTH directions prevents buy/sell deadlocks.
  INSERT INTO mock_accounts(user_id, cash) VALUES(p_user_id, 10000000)
    ON CONFLICT(user_id) DO NOTHING;
  PERFORM 1 FROM mock_accounts WHERE user_id = p_user_id FOR UPDATE;
  IF p_client_order_id IS NOT NULL THEN
    SELECT * INTO v_dup FROM mock_trades
    WHERE user_id = p_user_id AND client_order_id = p_client_order_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true,
        'price', v_dup.price, 'quantity', v_dup.quantity, 'total_amount', v_dup.total_amount);
    END IF;
  END IF;

  v_total := ROUND(p_price * p_quantity * 100) / 100;

  SELECT quantity, avg_price INTO v_held_qty, v_avg
  FROM mock_positions WHERE user_id = p_user_id AND ticker = p_ticker FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_position:%', p_ticker;
  END IF;

  IF v_held_qty < p_quantity THEN
    RAISE EXCEPTION 'insufficient_quantity:%:%', v_held_qty, p_quantity;
  END IF;

  -- 실현손익 = (실효 체결가 - 평단) × 수량 (체결가에 비용이 이미 반영돼 있음)
  v_realized := ROUND((p_price - COALESCE(v_avg, 0)) * p_quantity * 100) / 100;

  v_new_qty := v_held_qty - p_quantity;
  IF v_new_qty = 0 THEN
    DELETE FROM mock_positions WHERE user_id = p_user_id AND ticker = p_ticker;
  ELSE
    UPDATE mock_positions SET quantity = v_new_qty, updated_at = NOW()
    WHERE user_id = p_user_id AND ticker = p_ticker;
  END IF;

  -- 계좌행 부재 시에도 대금이 유실되지 않도록 upsert (기존: UPDATE 0행 → 유실)
  INSERT INTO mock_accounts(user_id, cash, updated_at)
  VALUES (p_user_id, v_total, NOW())
  ON CONFLICT (user_id)
  DO UPDATE SET cash = mock_accounts.cash + EXCLUDED.cash, updated_at = NOW()
  RETURNING cash INTO v_new_cash;

  INSERT INTO mock_trades(user_id, ticker, name, trade_type, quantity, price,
                          total_amount, client_order_id, realized_pnl)
  VALUES(p_user_id, p_ticker, p_name, 'SELL', p_quantity, p_price, v_total,
         p_client_order_id, v_realized);

  RETURN jsonb_build_object(
    'ok', true, 'duplicate', false, 'price', p_price, 'total_amount', v_total,
    'realized_pnl', v_realized, 'new_cash', ROUND(v_new_cash)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


REVOKE ALL ON FUNCTION execute_mock_buy(UUID, VARCHAR, VARCHAR, INTEGER, FLOAT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION execute_mock_sell(UUID, VARCHAR, VARCHAR, INTEGER, FLOAT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION execute_mock_buy(UUID, VARCHAR, VARCHAR, INTEGER, FLOAT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION execute_mock_sell(UUID, VARCHAR, VARCHAR, INTEGER, FLOAT, TEXT) TO service_role;

COMMIT;
