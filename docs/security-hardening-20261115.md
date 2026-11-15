# 보안 점검 및 하드닝 — 2026-11-15

정적 검토(Next.js API 69개 라우트, Supabase 마이그레이션, 레거시 FastAPI, GitHub 워크플로,
의존성, git 이력의 비밀값)와 오프라인 테스트로 수행했다. 운영 DB·Vercel·Supabase 대시보드는
조회하거나 변경하지 않았다.

## 수정

- 의존성: `next` 16.2.6 → 16.4.6. 16.2.6은 미들웨어/프록시 우회, 이미지 최적화 RCE·SSRF 등
  공개 권고 범위였다. 이 앱의 API 인가는 미들웨어에서 처리한다. sharp·postcss·follow-redirects·
  hono 등은 `npm audit fix` 범위 내 갱신. 남은 권고: yahoo-finance2 v3가 고정한 zod 3
  (공급자 응답 검증 시 메모리 고갈, 공격자가 Yahoo 응답을 조작해야 함). 해소하려면 v4 메이저 업그레이드 필요.
- 워크플로: 수동 입력을 셸 스크립트에 직접 삽입하던 3곳을 env 전달+형식 검증으로 변경
  (2곳은 service-role 키 보유 단계). 권한 블록이 없던 7개 워크플로에 `contents: read`.
- API 경계
  - 비GET `/api/*`(cron 제외)에서 Origin/Sec-Fetch-Site가 다른 출처면 403. SameSite=Lax
    쿠키만으로는 형제 서브도메인의 본문 없는 POST(계좌 리셋, 관리자 승인)를 막지 못한다.
  - cron 비밀값을 고정 길이 다이제스트의 `timingSafeEqual`로 비교(`lib/server/cron-auth.ts`).
  - 관리자 승인/거절/삭제는 본인·다른 관리자·잘못된 ID를 대상으로 할 수 없다. 이전에는
    유일한 관리자가 자기 행에서 승인(→role=user)이나 거절을 누르면 관리자를 잃었다.
  - 포트폴리오·관심종목·모의거래 내역 라우트가 `getUser()`만 보던 것을 승인 역할 검사로 교체
    (미들웨어와 이중 방어; 미들웨어 우회 권고가 실제로 있었다).
  - 요청 헤더(`x-app-key`/`x-app-secret`)로 증권사 키를 받던 4개 경로 삭제. 클라이언트는 이미
    보내지 않았고, 실패 시 axios 오류(헤더 포함)를 로그에 남길 수 있었다.
  - `x-fred-key`는 32자 소문자 영숫자만 허용하고 URL 인코딩한다(질의 파라미터 주입 방지).
  - 디버그 라우트 `/api/market/dart-test` 삭제.
  - 포트폴리오 자동 채우기는 포지션 수만큼 분석 쿼터를 차감하고 동시 3개로 제한. 포지션 분석은 동시 4개로 제한.
  - 가입 오류에서 공급자 원문 메시지 대신 일반 문구 반환.
- 헤더: HSTS, Permissions-Policy, 스크립트에 영향 없는 CSP 지시어
  (`frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`).
  nonce 기반 `script-src`는 프록시에서 nonce 생성과 브라우저 확인이 필요해 후속 작업이다.
- heartbeat: `user_profiles`는 004 이후 서버 전용이라 세션 클라이언트 갱신이 조용히 실패했다.
  service role로 호출자 행의 `last_seen_at`만 갱신한다.
- 레거시 백엔드: 자유 형식 `bld` 원시 전달 `/api/krx/debug` 제거, 예외 원문 응답 제거,
  `.dockerignore`로 `.env`/로컬 DB가 이미지에 들어가지 않게 함.

## 신규 마이그레이션 `20261115000001_privilege_defaults.sql`

기존 SQL 본문은 수정하지 않았다.
- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public`: 이후 생성되는 테이블·시퀀스·함수에서
  anon/authenticated 권한 제거, service_role DML 부여. Supabase 기본값은 새 public 테이블을 anon 키로
  읽고 쓸 수 있게 한다. 004는 고정 목록만 처리했다.
- 현재 모든 public 테이블(대시보드에서 만든 것 포함)에 RLS + anon/authenticated 권한 제거.
- 모든 public SECURITY DEFINER 함수: 현재 service_role 권한은 그대로 보존(레거시 매수/매도 우회는
  계속 차단), PUBLIC/anon/authenticated EXECUTE 제거, search_path 미설정 함수에
  `public, pg_temp` 설정(본문 불변).
- 전 컬럼 자기 수정이 가능하던 `users_update_own_last_seen` 정책 삭제.
- 가입 제한 `consume_signup_quota`: 클라이언트(IP의 HMAC)당 시간당 5회, 전체 시간당 30회.
  가입 API는 제한기를 사용할 수 없으면 503으로 실패한다.

배포 워크플로는 모든 마이그레이션의 원격 적용 증거(`verified-rollout.json`)를 요구한다.
이 마이그레이션을 운영에 적용하고 증거를 기록하기 전에는 이 커밋 이후 배포가 막힌다.

## 운영자가 확인할 것 (저장소만으로 확인 불가)

1. 구형 `kis-holdings` Edge Function이 배포돼 있으면 `supabase functions delete kis-holdings`.
   이전 버전은 `--no-verify-jwt`·CORS `*`로 임의 출처의 KIS 키를 받아 보유종목을 반환했다.
2. Supabase 보안 어드바이저 또는 `pg_class`(relkind v/m), `storage.buckets`,
   `pg_publication_tables`로 대시보드에서 만든 뷰·버킷·공개 발행 확인.
3. 004 이전(2026-10-31 확인 전)에는 anon 키로 모든 테이블 접근이 가능했다. 암호화된 증권사 키
   암호문이 노출됐을 수 있으므로 KIS 키 재발급을 권장한다.
4. `frontend/supabase-migration.sql`, `supabase/schema.sql`은 마이그레이션 이후 재실행하면 안 된다
   (RLS 비활성화, 하드코딩된 관리자 이메일 트리거 복원).

## 남은 위험 (이번 범위 밖)

- 가입은 `email_confirm: true`로 이메일 소유 확인 없이 계정을 만든다. 관리자 승인이 유일한 방어다.
  Supabase 확인 메일/초대 흐름 전환은 SMTP 설정이 필요하다.
- `@supabase/ssr` 세션 쿠키는 JS에서 읽을 수 있다. XSS가 생기면 토큰 탈취로 이어지므로 CSP `script-src` 도입이 다음 우선순위다.
- 다수 라우트가 PostgREST `error.message`를 승인 사용자에게 반환한다(스키마 정보 노출, 키는 아님).
- 증권사 키 AES-GCM 암호문이 사용자 ID/브로커 유형에 바인딩(AAD)되지 않는다. DB 쓰기 권한자가
  다른 사용자 행으로 옮길 수 있다. 기존 암호문 재암호화 계획과 함께 변경해야 한다.
- 시장 데이터 라우트 일부는 미들웨어 인가에만 의존한다(사용자 데이터는 없음).

## 검증

`node --test scripts/test_*.mjs frontend/components/portfolio/*.test.mjs`(103 통과),
`npm run test:trading`, `npm run test:trading-db`, Python 안전성 테스트, `tsc`, lint 기준선(회귀 0),
CI 자리표시자 환경 프로덕션 빌드. 신규 테스트는 마이그레이션 없이 실행하면 실패함을 확인했다
(대시보드 생성 테이블이 anon에 노출).
