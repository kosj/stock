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
CREATE INDEX IF NOT EXISTS idx_mock_trades_user ON mock_trades(user_id);

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
CREATE INDEX IF NOT EXISTS idx_auto_trade_logs_user ON mock_auto_trade_logs(user_id);
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
