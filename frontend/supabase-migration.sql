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
