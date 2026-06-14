-- Migration: prophet_recommendations.rank → nullable + UNIQUE 제약 교체
-- 실행 방법: Supabase Dashboard > SQL Editor 에 붙여넣고 Run
-- 목적: Python 앙상블이 Top20 외 유니버스 전체(51종목)를 저장할 수 있도록
--       rank 컬럼의 NOT NULL 제약 제거 + UNIQUE 기준을 (run_date, ticker)로 교체

-- 1. rank NOT NULL 제약 제거
ALTER TABLE prophet_recommendations
  ALTER COLUMN rank DROP NOT NULL;

-- 2. 기존 UNIQUE(run_date, rank) 제약 삭제
--    (제약 이름이 다를 경우 아래 조회로 확인)
--    SELECT constraint_name FROM information_schema.table_constraints
--    WHERE table_name='prophet_recommendations' AND constraint_type='UNIQUE';
ALTER TABLE prophet_recommendations
  DROP CONSTRAINT IF EXISTS prophet_recommendations_run_date_rank_key;

-- 3. UNIQUE(run_date, ticker) 추가 (당일 동일 ticker 중복 방지)
ALTER TABLE prophet_recommendations
  ADD CONSTRAINT prophet_recommendations_run_date_ticker_key
  UNIQUE (run_date, ticker);
