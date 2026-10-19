-- price_alerts 사용자 스코프 (Supabase SQL Editor에서 실행)
-- ============================================================================
-- 이 테이블에는 user_id가 없어 "누구의 알림인지" 구분할 수 없었다. API에는
-- 인증을 이미 적용했으나(로그인 없이 접근 불가), 로그인 사용자 간 분리는
-- 이 컬럼이 있어야 가능하다. 적용 후 라우트에 user_id 필터를 연결한다.
ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS user_id UUID;
CREATE INDEX IF NOT EXISTS idx_price_alerts_user ON price_alerts(user_id);
-- 기존 행은 user_id가 NULL이다. 단일 사용자 환경이면 아래로 귀속시킬 수 있다:
--   UPDATE price_alerts SET user_id = '<본인 auth.users.id>' WHERE user_id IS NULL;
