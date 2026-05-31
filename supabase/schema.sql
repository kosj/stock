-- ============================================================
-- 주식 대시보드 Supabase 스키마
-- Supabase Dashboard → SQL Editor에서 실행
-- ============================================================

-- portfolios
CREATE TABLE IF NOT EXISTS portfolios (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

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
  ticker    VARCHAR(20)  NOT NULL UNIQUE,
  name      VARCHAR(100) NOT NULL,
  sector    VARCHAR(50),
  added_at  TIMESTAMPTZ  DEFAULT NOW()
);

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
-- RLS 비활성화 (개인 프로젝트 — 서버사이드 API Route만 접근)
-- ============================================================
ALTER TABLE portfolios           DISABLE ROW LEVEL SECURITY;
ALTER TABLE positions            DISABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist            DISABLE ROW LEVEL SECURITY;
ALTER TABLE price_alerts         DISABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions   DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_broker_configs  DISABLE ROW LEVEL SECURITY;
