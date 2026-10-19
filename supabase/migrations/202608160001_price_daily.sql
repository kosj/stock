-- 일별 시세 스냅샷 (Supabase SQL Editor에서 1회 실행)
-- ============================================================================
-- 배경 — 실측된 재현성 결함
--   앙상블은 매 실행마다 yfinance에서 5년치 시세를 새로 받는다. 그런데 같은 날
--   같은 코드로 5분 간격 두 번 돌리면 결과가 달라졌다(2026-08-15 dry-run 8회):
--     종목종가 전체 해시  d6cc774b4d0f  vs  3cbe83c94dd4   (행 수는 109,577로 동일)
--     삼성전자 모델순위    51 ~ 59위
--     SK하이닉스 모델순위  38 ~ 46위
--     OOF 일별 IC          +0.0399 ~ +0.0434
--     Top20 구성           휴젤·HD한국조선해양·카카오뱅크 진입/이탈 반복
--   최근 60일 통계는 8회 모두 동일했고 전체 해시만 달랐다 → 과거 구간의 값이
--   흔들린다. auto_adjust=True 로 받는 배당·분할 소급 조정가가 호출마다 미세하게
--   달라지는 것이 원인이다.
--   IC 변동 폭이 알고리즘 개선의 효과 크기보다 커서, 이 상태로는 어떤 개선도
--   측정할 수 없다.
--
-- 설계
--   - (ticker, date) 유일 → 같은 날 재실행은 멱등
--   - 한 번 적재된 행은 덮어쓰지 않는다(append-only). 이것이 재현성의 핵심이다.
--     야후가 다음 호출에 다른 값을 줘도 저장본이 우선이라 입력이 고정된다.
--   - 단, 분할·대규모 배당 같은 실제 기업행위가 발생하면 과거 전체가 재스케일
--     돼야 한다. 적재기가 중복 구간의 괴리율을 보고 임계 초과 시에만 해당
--     티커 전체를 재적재한다(로그로 남김).
--   - 벤치마크(^KS11)도 같은 테이블에 ticker='^KS11'로 저장한다.
--   - 조정가는 원 단위가 아니므로(예: 275,196.43) NUMERIC 으로 둔다.

CREATE TABLE IF NOT EXISTS price_daily (
  ticker  TEXT        NOT NULL,          -- yfinance 심볼 (005930.KS, ^KS11 …)
  date    DATE        NOT NULL,
  open    NUMERIC,
  high    NUMERIC,
  low     NUMERIC,
  close   NUMERIC     NOT NULL,
  volume  NUMERIC,
  PRIMARY KEY (ticker, date)
);

-- 티커별 기간 조회가 주 패턴 (PK 선두가 ticker라 대부분 커버되지만
-- 날짜 범위 단독 조회/정리 작업을 위해 보조 인덱스를 둔다)
CREATE INDEX IF NOT EXISTS idx_price_daily_date ON price_daily (date);

-- 서비스 롤(CI 잡)만 쓰고 프런트는 읽지 않는다 → RLS 켜고 정책 없음.
-- service_role 키는 RLS를 우회하므로 적재·조회 모두 정상 동작한다.
ALTER TABLE price_daily ENABLE ROW LEVEL SECURITY;
