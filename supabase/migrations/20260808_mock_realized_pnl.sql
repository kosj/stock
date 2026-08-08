-- 모의투자 잔여 이슈 마이그레이션 (Supabase SQL Editor에서 1회 실행)
-- ① 매도 시 실현손익(realized_pnl) 기록 — 승률/MDD 등 성과지표의 전제
-- ② 계좌행 부재 시 매도대금 유실 가드 (UPDATE 0행 → upsert)
-- 코드 배포와 순서 무관하게 안전: 컬럼은 IF NOT EXISTS, 함수는 REPLACE,
-- API 호출 시그니처는 변경 없음.

ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS realized_pnl NUMERIC;

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
  IF p_client_order_id IS NOT NULL THEN
    SELECT * INTO v_dup FROM mock_trades
    WHERE user_id = p_user_id AND client_order_id = p_client_order_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true,
        'price', v_dup.price, 'total_amount', v_dup.total_amount);
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
