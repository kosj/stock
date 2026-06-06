-- ============================================================
-- 주식 대시보드 Supabase 스키마
-- Supabase Dashboard → SQL Editor에서 실행
-- ============================================================

-- portfolios
CREATE TABLE IF NOT EXISTS portfolios (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID         NOT NULL,            -- auth.users.id
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portfolios_user ON portfolios(user_id);

-- positions
CREATE TABLE IF NOT EXISTS positions (
  id           BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT       REFERENCES portfolios(id) ON DELETE CASCADE,
  ticker       VARCHAR(20)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  quantity     INTEGER      NOT NULL,
  avg_price    FLOAT        NOT NULL,
  stop_loss    FLOAT,
  take_profit  FLOAT,
  strategy     TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_positions_portfolio ON positions(portfolio_id);

-- watchlist
CREATE TABLE IF NOT EXISTS watchlist (
  id        BIGSERIAL PRIMARY KEY,
  user_id   UUID         NOT NULL,              -- auth.users.id
  ticker    VARCHAR(20)  NOT NULL,
  name      VARCHAR(100) NOT NULL,
  sector    VARCHAR(50),
  added_at  TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(user_id, ticker)                        -- 사용자별 중복 방지 (ticker 단독 UNIQUE는 멀티유저 불가)
);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);

-- price_alerts
CREATE TABLE IF NOT EXISTS price_alerts (
  id              BIGSERIAL PRIMARY KEY,
  ticker          VARCHAR(20)  NOT NULL,
  position_id     BIGINT       REFERENCES positions(id) ON DELETE SET NULL,
  alert_type      VARCHAR(20)  NOT NULL,  -- stop_loss | take_profit | custom
  direction       VARCHAR(10)  NOT NULL,  -- above | below
  threshold       FLOAT        NOT NULL,
  message         TEXT,
  is_active       BOOLEAN      DEFAULT TRUE,
  last_triggered  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alerts_ticker ON price_alerts(ticker);

-- push_subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  endpoint    TEXT        UNIQUE NOT NULL,
  p256dh      TEXT        NOT NULL,
  auth        VARCHAR(100) NOT NULL,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- user_broker_configs
-- 사용자별 증권사 API 자격증명 (서버사이드 AES-256-GCM 암호화 저장)
-- BROKER_ENCRYPTION_KEY 환경변수로 암호화 (Vercel 설정 필요)
CREATE TABLE IF NOT EXISTS user_broker_configs (
  id           BIGSERIAL    PRIMARY KEY,
  user_id      UUID         NOT NULL,         -- auth.users.id
  broker_type  VARCHAR(20)  NOT NULL,          -- 'kis' | 'kb' | ...
  config_enc   TEXT         NOT NULL,          -- AES-256-GCM 암호화 JSON
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(user_id, broker_type)
);
CREATE INDEX IF NOT EXISTS idx_broker_configs_user ON user_broker_configs(user_id);

-- ============================================================
-- 모의 투자 (Paper Trading) — KIS 없이 내부 Supabase 저장
-- ============================================================

-- 모의 계좌 (사용자당 1개, 최초 접근 시 자동 생성)
CREATE TABLE IF NOT EXISTS mock_accounts (
  id                   BIGSERIAL    PRIMARY KEY,
  user_id              UUID         NOT NULL UNIQUE,
  cash                 FLOAT        NOT NULL DEFAULT 10000000,  -- 초기 자금 1000만원
  auto_trade_capital   FLOAT,       -- 자동매매 투입 자본금 (NULL = 전체 현금 사용)
  created_at           TIMESTAMPTZ  DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  DEFAULT NOW()
);
-- 기존 테이블에 컬럼 추가 (이미 생성된 경우)
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS auto_trade_capital FLOAT;

-- 모의 보유 포지션
CREATE TABLE IF NOT EXISTS mock_positions (
  id         BIGSERIAL    PRIMARY KEY,
  user_id    UUID         NOT NULL,
  ticker     VARCHAR(20)  NOT NULL,
  name       VARCHAR(100) NOT NULL,
  quantity   INTEGER      NOT NULL,
  avg_price  FLOAT        NOT NULL,
  updated_at TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(user_id, ticker)
);
CREATE INDEX IF NOT EXISTS idx_mock_positions_user ON mock_positions(user_id);

-- 거래 체결 내역
CREATE TABLE IF NOT EXISTS mock_trades (
  id           BIGSERIAL    PRIMARY KEY,
  user_id      UUID         NOT NULL,
  ticker       VARCHAR(20)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  trade_type   VARCHAR(4)   NOT NULL,  -- 'BUY' | 'SELL'
  quantity     INTEGER      NOT NULL,
  price        FLOAT        NOT NULL,
  total_amount FLOAT        NOT NULL,
  created_at   TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mock_trades_user    ON mock_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_mock_trades_created ON mock_trades(created_at);

-- ============================================================
-- RPC 함수 — 소유권 검증 + DML을 단일 왕복으로 처리
-- Supabase SQL Editor에서 실행 필요
-- ============================================================

-- positions 삽입 (portfolio 소유권 검증 포함, INSERT → verify 2 왕복 → 1 왕복)
CREATE OR REPLACE FUNCTION insert_position_owned(
  p_portfolio_id BIGINT,
  p_user_id      UUID,
  p_ticker       VARCHAR,
  p_name         VARCHAR,
  p_quantity     INTEGER,
  p_avg_price    FLOAT,
  p_stop_loss    FLOAT    DEFAULT NULL,
  p_take_profit  FLOAT    DEFAULT NULL,
  p_strategy     TEXT     DEFAULT NULL,
  p_notes        TEXT     DEFAULT NULL
) RETURNS SETOF positions AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM portfolios WHERE id = p_portfolio_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  RETURN QUERY
  INSERT INTO positions (portfolio_id, ticker, name, quantity, avg_price, stop_loss, take_profit, strategy, notes)
  VALUES (p_portfolio_id, p_ticker, p_name, p_quantity, p_avg_price, p_stop_loss, p_take_profit, p_strategy, p_notes)
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- position 삭제 (portfolio 소유권 검증 포함, DELETE+JOIN 단일 쿼리)
CREATE OR REPLACE FUNCTION delete_position_owned(
  p_position_id BIGINT,
  p_user_id     UUID
) RETURNS BOOLEAN AS $$
DECLARE cnt INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM positions
    USING portfolios
    WHERE positions.id           = p_position_id
      AND positions.portfolio_id = portfolios.id
      AND portfolios.user_id     = p_user_id
    RETURNING positions.id
  )
  SELECT COUNT(*) INTO cnt FROM deleted;
  RETURN cnt > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- position 수정 (portfolio 소유권 검증 + UPDATE 단일 왕복)
-- 현재 PUT: SELECT(소유권) → UPDATE = 2 왕복 → 1 왕복으로 단축
CREATE OR REPLACE FUNCTION update_position_owned(
  p_position_id BIGINT,
  p_user_id     UUID,
  p_ticker      VARCHAR,
  p_name        VARCHAR,
  p_quantity    INTEGER,
  p_avg_price   FLOAT,
  p_stop_loss   FLOAT    DEFAULT NULL,
  p_take_profit FLOAT    DEFAULT NULL,
  p_strategy    TEXT     DEFAULT NULL,
  p_notes       TEXT     DEFAULT NULL
) RETURNS SETOF positions AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM positions p
    JOIN portfolios pf ON p.portfolio_id = pf.id
    WHERE p.id = p_position_id AND pf.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  RETURN QUERY
  UPDATE positions SET
    ticker      = p_ticker,
    name        = p_name,
    quantity    = p_quantity,
    avg_price   = p_avg_price,
    stop_loss   = p_stop_loss,
    take_profit = p_take_profit,
    strategy    = p_strategy,
    notes       = p_notes,
    updated_at  = NOW()
  WHERE id = p_position_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 모의거래 원자적 RPC — BUY/SELL을 단일 트랜잭션으로 처리
-- 현재: getQuote(1) + SELECT계좌(2) + SELECT포지션(3) + UPDATE포지션(4) + UPDATE계좌(5) + INSERT거래(6) = 6 왕복
-- RPC:  getQuote(1) + rpc(2) = 2 왕복
-- ============================================================

CREATE OR REPLACE FUNCTION execute_mock_buy(
  p_user_id  UUID,
  p_ticker   VARCHAR,
  p_name     VARCHAR,
  p_quantity INTEGER,
  p_price    FLOAT
) RETURNS JSONB AS $$
DECLARE
  v_total    FLOAT;
  v_cash     FLOAT;
  v_old_qty  INTEGER;
  v_old_avg  FLOAT;
  v_new_qty  INTEGER;
  v_new_avg  FLOAT;
  v_new_cash FLOAT;
BEGIN
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

  -- 거래 기록
  INSERT INTO mock_trades(user_id, ticker, name, trade_type, quantity, price, total_amount)
  VALUES(p_user_id, p_ticker, p_name, 'BUY', p_quantity, p_price, v_total);

  RETURN jsonb_build_object(
    'ok', true, 'price', p_price, 'total_amount', v_total, 'new_cash', ROUND(v_new_cash)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION execute_mock_sell(
  p_user_id  UUID,
  p_ticker   VARCHAR,
  p_name     VARCHAR,
  p_quantity INTEGER,
  p_price    FLOAT
) RETURNS JSONB AS $$
DECLARE
  v_total    FLOAT;
  v_held_qty INTEGER;
  v_new_qty  INTEGER;
  v_cash     FLOAT;
  v_new_cash FLOAT;
BEGIN
  v_total := ROUND(p_price * p_quantity * 100) / 100;

  -- 보유 수량 확인 (잠금)
  SELECT quantity INTO v_held_qty
  FROM mock_positions WHERE user_id = p_user_id AND ticker = p_ticker FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_position:%', p_ticker;
  END IF;

  IF v_held_qty < p_quantity THEN
    RAISE EXCEPTION 'insufficient_quantity:%:%', v_held_qty, p_quantity;
  END IF;

  -- 포지션 업데이트/삭제
  v_new_qty := v_held_qty - p_quantity;
  IF v_new_qty = 0 THEN
    DELETE FROM mock_positions WHERE user_id = p_user_id AND ticker = p_ticker;
  ELSE
    UPDATE mock_positions SET quantity = v_new_qty, updated_at = NOW()
    WHERE user_id = p_user_id AND ticker = p_ticker;
  END IF;

  -- 현금 증가
  SELECT cash INTO v_cash FROM mock_accounts WHERE user_id = p_user_id FOR UPDATE;
  v_new_cash := COALESCE(v_cash, 0) + v_total;
  UPDATE mock_accounts SET cash = v_new_cash, updated_at = NOW() WHERE user_id = p_user_id;

  -- 거래 기록
  INSERT INTO mock_trades(user_id, ticker, name, trade_type, quantity, price, total_amount)
  VALUES(p_user_id, p_ticker, p_name, 'SELL', p_quantity, p_price, v_total);

  RETURN jsonb_build_object(
    'ok', true, 'price', p_price, 'total_amount', v_total, 'new_cash', ROUND(v_new_cash)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RLS 비활성화 (개인 프로젝트 — 서버사이드 API Route만 접근)
-- ============================================================
ALTER TABLE portfolios           DISABLE ROW LEVEL SECURITY;
ALTER TABLE positions            DISABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist            DISABLE ROW LEVEL SECURITY;
ALTER TABLE price_alerts         DISABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions   DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_broker_configs  DISABLE ROW LEVEL SECURITY;
ALTER TABLE mock_accounts        DISABLE ROW LEVEL SECURITY;
ALTER TABLE mock_positions       DISABLE ROW LEVEL SECURITY;
ALTER TABLE mock_trades          DISABLE ROW LEVEL SECURITY;

-- 자동매매 실행 이력
CREATE TABLE IF NOT EXISTS mock_auto_trade_logs (
  id               BIGSERIAL    PRIMARY KEY,
  user_id          UUID         NOT NULL,
  run_at           TIMESTAMPTZ  DEFAULT NOW(),
  tickers_analyzed INTEGER      DEFAULT 0,
  trades_buy       INTEGER      DEFAULT 0,
  trades_sell      INTEGER      DEFAULT 0,
  skipped          INTEGER      DEFAULT 0,
  details          JSONB,        -- [{ticker, action, reason, qty, price}]
  error            TEXT
);
CREATE INDEX IF NOT EXISTS idx_auto_trade_logs_user    ON mock_auto_trade_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_trade_logs_created ON mock_auto_trade_logs(run_at);
ALTER TABLE mock_auto_trade_logs DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- 자동 데이터 정리
-- 방법 A: pg_cron 활성화 시 아래 주석 해제 후 SQL Editor에서 실행
--         (Supabase Dashboard → Database → Extensions → pg_cron 활성화)
-- 방법 B: pg_cron 없으면 .github/workflows/supabase-keepalive.yml이 주말마다 정리
-- ============================================================

-- [방법 A] pg_cron 사용 시 주석 해제
-- SELECT cron.schedule('cleanup-mock-trades',    '0 3 * * *', $$DELETE FROM mock_trades       WHERE created_at < NOW() - INTERVAL '90 days'$$);
-- SELECT cron.schedule('cleanup-auto-trade-logs','0 3 * * *', $$DELETE FROM mock_auto_trade_logs WHERE run_at  < NOW() - INTERVAL '30 days'$$);
-- SELECT cron.schedule('cleanup-quote-cache',    '0 * * * *', $$DELETE FROM quote_cache         WHERE expires_at < NOW()$$);

-- ============================================================
-- 외부 API 응답 캐시 (cold start 간 캐시 유지)
-- L2 캐시: 서버리스 인스턴스 재시작 후에도 캐시 유효
-- ============================================================
CREATE TABLE IF NOT EXISTS quote_cache (
  key        TEXT         PRIMARY KEY,
  data       JSONB        NOT NULL,
  expires_at TIMESTAMPTZ  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quote_cache_exp ON quote_cache(expires_at);
ALTER TABLE quote_cache DISABLE ROW LEVEL SECURITY;

-- Prophet 추천 결과 저장 (이미 있다면 스킵)
CREATE TABLE IF NOT EXISTS prophet_recommendations (
  id                   BIGSERIAL    PRIMARY KEY,
  run_date             DATE         NOT NULL,
  rank                 INTEGER      NOT NULL,
  ticker               VARCHAR(20)  NOT NULL,
  name                 VARCHAR(100),
  market               VARCHAR(20),
  sector               VARCHAR(50),
  current_price        FLOAT,
  predicted_return_7d  FLOAT,
  predicted_return_30d FLOAT,
  bull_return_30d      FLOAT,
  base_return_30d      FLOAT,
  bear_return_30d      FLOAT,
  recommendation       VARCHAR(20),
  r_squared            FLOAT,
  trend_direction      VARCHAR(20),
  accuracy_json        TEXT,
  created_at           TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(run_date, rank)
);
CREATE INDEX IF NOT EXISTS idx_prophet_rec_date ON prophet_recommendations(run_date);
ALTER TABLE prophet_recommendations DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- 섹터 로테이션 — ETF 마스터 & 일별 종가
-- ============================================================

-- sector_etfs: 추적할 섹터 ETF 목록
CREATE TABLE IF NOT EXISTS sector_etfs (
  id          SERIAL      PRIMARY KEY,
  ticker      TEXT        NOT NULL UNIQUE,
  sector_name TEXT        NOT NULL,
  etf_name    TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sector_etfs DISABLE ROW LEVEL SECURITY;

-- 초기 데이터: 국내 대표 10개 섹터 KODEX ETF
INSERT INTO sector_etfs (ticker, sector_name, etf_name) VALUES
  ('091160', '반도체',    'KODEX 반도체'),
  ('305720', '2차전지',   'KODEX 2차전지산업'),
  ('244580', '바이오',    'KODEX 바이오'),
  ('139260', '인터넷/IT', 'KODEX 인터넷'),
  ('091180', '자동차',    'KODEX 자동차'),
  ('139270', '금융',      'KODEX 은행'),
  ('117460', '에너지',    'KODEX 에너지화학'),
  ('139220', '건설',      'KODEX 건설'),
  ('139230', '철강/소재', 'KODEX 철강'),
  ('364980', 'AI/로봇',   'KODEX K-로봇액티브')
ON CONFLICT (ticker) DO NOTHING;

-- etf_daily_prices: ETF 일별 종가 (etf_id + date Unique)
CREATE TABLE IF NOT EXISTS etf_daily_prices (
  id          BIGSERIAL    PRIMARY KEY,
  etf_id      INTEGER      NOT NULL REFERENCES sector_etfs(id) ON DELETE CASCADE,
  date        DATE         NOT NULL,
  close_price NUMERIC(12,2) NOT NULL,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (etf_id, date)
);
-- 모멘텀 계산 쿼리(etf_id 기준 최신 N행 조회)에 최적화
CREATE INDEX IF NOT EXISTS idx_etf_prices_etf_date ON etf_daily_prices(etf_id, date DESC);
ALTER TABLE etf_daily_prices DISABLE ROW LEVEL SECURITY;

