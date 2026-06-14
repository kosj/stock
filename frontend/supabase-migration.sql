-- ============================================================
-- StockBoard 로그인 시스템 마이그레이션
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 1. user_profiles 테이블 생성
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  full_name    TEXT,
  role         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (role IN ('admin', 'user', 'pending', 'rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at  TIMESTAMPTZ,
  approved_by  TEXT
);

-- 2. RLS 활성화
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- 본인 프로필 읽기
CREATE POLICY "users_read_own_profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = id);

-- 3. 신규 사용자 가입 시 자동 프로필 생성 트리거
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    CASE WHEN NEW.email = 'godkosj@gmail.com' THEN 'admin' ELSE 'pending' END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 마지막 접속 자체 추적 (last_seen_at) 마이그레이션
-- 기존 DB에 적용 시 아래 구문을 Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 4. last_seen_at 컬럼 추가 (앱 접속 시 heartbeat API가 갱신)
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- 5. 사용자가 자신의 last_seen_at을 업데이트할 수 있도록 RLS 정책 추가
DROP POLICY IF EXISTS "users_update_own_last_seen" ON public.user_profiles;
CREATE POLICY "users_update_own_last_seen"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ============================================================
-- 자동매매 계정별 개인화 (Phase 0) — 모의/실전 모드를 계정 단위로 관리
-- 기존 DB에 적용 시 아래 구문을 Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 6. mock_accounts.trading_mode 컬럼 추가 (기본 'mock', 실전은 Phase 2 어댑터 연결 후)
ALTER TABLE public.mock_accounts
  ADD COLUMN IF NOT EXISTS trading_mode TEXT NOT NULL DEFAULT 'mock';

-- CHECK 제약은 중복 추가 시 오류가 나므로 존재하지 않을 때만 부여
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mock_accounts_trading_mode_check'
  ) THEN
    ALTER TABLE public.mock_accounts
      ADD CONSTRAINT mock_accounts_trading_mode_check
      CHECK (trading_mode IN ('mock', 'real'));
  END IF;
END $$;

-- ============================================================
-- 자동매매 주문 멱등성 (Phase 1) — clientOrderId로 재시도 시 이중 체결 차단
-- 기존 DB에 적용 시 아래 전체를 Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 7. mock_trades.client_order_id 컬럼 + 부분 유일 인덱스
ALTER TABLE public.mock_trades ADD COLUMN IF NOT EXISTS client_order_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mock_trades_client_order
  ON public.mock_trades(user_id, client_order_id) WHERE client_order_id IS NOT NULL;

-- 8. 멱등 RPC(6-arg)로 교체 — 기존 5-arg 시그니처 제거 후 재정의
--    (수동 거래는 client_order_id를 NULL로 호출 → 기존과 동일하게 동작)
DROP FUNCTION IF EXISTS public.execute_mock_buy(uuid, character varying, character varying, integer, double precision);
DROP FUNCTION IF EXISTS public.execute_mock_sell(uuid, character varying, character varying, integer, double precision);

CREATE OR REPLACE FUNCTION public.execute_mock_buy(
  p_user_id  UUID,
  p_ticker   VARCHAR,
  p_name     VARCHAR,
  p_quantity INTEGER,
  p_price    FLOAT,
  p_client_order_id TEXT DEFAULT NULL
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

  INSERT INTO mock_accounts(user_id, cash) VALUES(p_user_id, 10000000)
  ON CONFLICT(user_id) DO NOTHING;

  SELECT cash INTO v_cash FROM mock_accounts WHERE user_id = p_user_id FOR UPDATE;
  IF v_cash < v_total THEN
    RAISE EXCEPTION 'insufficient_cash:%.0f:%.0f', v_cash, v_total;
  END IF;

  SELECT quantity, avg_price INTO v_old_qty, v_old_avg
  FROM mock_positions WHERE user_id = p_user_id AND ticker = p_ticker;

  IF FOUND THEN
    v_new_qty := v_old_qty + p_quantity;
    v_new_avg := ROUND(((v_old_avg * v_old_qty) + v_total) / v_new_qty * 100) / 100;
    UPDATE mock_positions SET quantity = v_new_qty, avg_price = v_new_avg, updated_at = NOW()
    WHERE user_id = p_user_id AND ticker = p_ticker;
  ELSE
    INSERT INTO mock_positions(user_id, ticker, name, quantity, avg_price)
    VALUES(p_user_id, p_ticker, p_name, p_quantity, p_price);
  END IF;

  v_new_cash := v_cash - v_total;
  UPDATE mock_accounts SET cash = v_new_cash, updated_at = NOW() WHERE user_id = p_user_id;

  INSERT INTO mock_trades(user_id, ticker, name, trade_type, quantity, price, total_amount, client_order_id)
  VALUES(p_user_id, p_ticker, p_name, 'BUY', p_quantity, p_price, v_total, p_client_order_id);

  RETURN jsonb_build_object('ok', true, 'duplicate', false,
    'price', p_price, 'total_amount', v_total, 'new_cash', ROUND(v_new_cash));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.execute_mock_sell(
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

  SELECT quantity INTO v_held_qty
  FROM mock_positions WHERE user_id = p_user_id AND ticker = p_ticker FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_position:%', p_ticker;
  END IF;
  IF v_held_qty < p_quantity THEN
    RAISE EXCEPTION 'insufficient_quantity:%:%', v_held_qty, p_quantity;
  END IF;

  v_new_qty := v_held_qty - p_quantity;
  IF v_new_qty = 0 THEN
    DELETE FROM mock_positions WHERE user_id = p_user_id AND ticker = p_ticker;
  ELSE
    UPDATE mock_positions SET quantity = v_new_qty, updated_at = NOW()
    WHERE user_id = p_user_id AND ticker = p_ticker;
  END IF;

  SELECT cash INTO v_cash FROM mock_accounts WHERE user_id = p_user_id FOR UPDATE;
  v_new_cash := COALESCE(v_cash, 0) + v_total;
  UPDATE mock_accounts SET cash = v_new_cash, updated_at = NOW() WHERE user_id = p_user_id;

  INSERT INTO mock_trades(user_id, ticker, name, trade_type, quantity, price, total_amount, client_order_id)
  VALUES(p_user_id, p_ticker, p_name, 'SELL', p_quantity, p_price, v_total, p_client_order_id);

  RETURN jsonb_build_object('ok', true, 'duplicate', false,
    'price', p_price, 'total_amount', v_total, 'new_cash', ROUND(v_new_cash));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
