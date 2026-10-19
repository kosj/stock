-- ETF 추천 이력 (Supabase SQL Editor에서 1회 실행)
-- ============================================================================
-- ETF 추천은 매 요청마다 즉석 계산돼 이력이 남지 않아, 순위 산출 방식을 바꿔도
-- (예: 순수 모멘텀 → 모멘텀+변동성 혼합) 실현 성과를 측정할 수 없었다.
-- 매일 추천 스냅샷을 적재해 주간 백테스트가 실현 알파를 산출하게 한다.
--
-- 설계:
--   - (run_date, account, period, ticker) 유일 → 같은 날 재실행은 멱등 upsert
--   - 순위 산출 근거(수익률·변동성·혼합점수)와 진입 레벨을 함께 저장해
--     사후에 "왜 이 종목이 추천됐는지"를 재현할 수 있게 한다
--   - Top-N 밖 종목도 저장하면 IC(전체 순위 상관) 측정이 가능하므로
--     rank는 NULL 허용(스냅샷 스크립트가 상위 N에만 rank 부여)

CREATE TABLE IF NOT EXISTS etf_pick_history (
  id            BIGSERIAL   PRIMARY KEY,
  run_date      DATE        NOT NULL,
  account       TEXT        NOT NULL,          -- pension | irp | isa | stock
  period        TEXT        NOT NULL,          -- 1M | 3M | 6M ...
  rank          INTEGER,                       -- 추천 순위(Top-N만), 그 외 NULL
  ticker        TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  category      TEXT,
  price         NUMERIC,
  -- 순위 산출 근거
  sort_return   NUMERIC,                       -- 정렬 기준 구간 수익률(%)
  ann_vol_pct   NUMERIC,                       -- 연환산 변동성(%)
  blend_score   NUMERIC,                       -- 모멘텀+변동성 혼합 점수
  drawdown_pct  NUMERIC,                       -- 52주 전고점 대비(%)
  -- 진입/리스크 레벨 (ATR 기반)
  entry_state   TEXT,                          -- buy_zone | watch | overbought | weak
  entry_low     NUMERIC,
  entry_high    NUMERIC,
  stop_loss     NUMERIC,
  take_profit   NUMERIC,
  risk_reward   NUMERIC,
  -- 상품 속성 (사후 분석용)
  leveraged     BOOLEAN     DEFAULT FALSE,
  inverse       BOOLEAN     DEFAULT FALSE,
  derivative    BOOLEAN     DEFAULT FALSE,
  safe_type     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (run_date, account, period, ticker)
);

CREATE INDEX IF NOT EXISTS idx_etf_pick_hist_run   ON etf_pick_history(run_date DESC);
CREATE INDEX IF NOT EXISTS idx_etf_pick_hist_scope ON etf_pick_history(account, period, run_date DESC);
ALTER TABLE etf_pick_history DISABLE ROW LEVEL SECURITY;
