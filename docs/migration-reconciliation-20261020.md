# 마이그레이션 이력 정리와 배포 점검

2026-10-20 KST. 대상: `kosj's Project`, `enunwzitobtgrelzdudd`.
신규 5개 SQL 적용은 이전 기록을 따르며, 이번에는 과거 수동 적용분의 기준 이력을 정리했다.

## 기준 이력 대조와 등록 완료

CLI의 읽기 전용 SQL 결과를 PGlite에서 과거 SQL을 재생한 결과와 대조했다.
대상 44개 컬럼의 타입/NULL 제약, 15개 인덱스, 6개 제약조건,
매수·매도·lease 획득/반환·추천 발행 함수 5개의 정의가 일치했다.
더 오래된 매도 구현은 최신 guard 함수로 대체된 상태를 확인했다.
이미 적용한 최신 RLS/권한을 되돌리지 않았고, 과거 SQL을 재실행하지 않았다.
관계없는 기존 컬럼 타입이나 PostgreSQL 18의 별도 NOT NULL constraint 카탈로그는
비교 대상에 섞지 않았다. NULL 제약 자체는 information_schema에서 대조했다.

기존 파일은 **본문 바이트를 변경하지 않고** 다음 고유 버전으로 이름만 변경했다.

| 과거 파일 | 고유 버전 파일 |
|---|---|
| 20260808_mock_realized_pnl.sql | 202608080001_mock_realized_pnl.sql |
| 20260810_etf_pick_history.sql | 202608100001_etf_pick_history.sql |
| 20260810_price_alerts_user_scope.sql | 202608100002_price_alerts_user_scope.sql |
| 20260816_price_daily.sql | 202608160001_price_daily.sql |
| 20261019_mock_order_guards.sql | 202610190001_mock_order_guards.sql |
| 20261019_trading_safety.sql | 202610190002_trading_safety.sql |

이 버전들은 과거 실행 시각을 복원한 값이 아니라 **정렬을 위한 채택 기준 버전**이다.
원래 실행 시각은 알 수 없고, 현재 스키마가 해당 변경 또는 최신 대체 구현을 포함한다는 증거로
채택했다. `supabase/historical-migrations.json`에 기존 이름과 SHA256을 보존했다.

원격 함수가 점검 이후 변경되지 않았는지, 신규 5개 이력의 원문이 파일과 일치하는지 재확인하는
트랜잭션 안에서 과거 6개 이력만 등록했다. 계좌·거래·가격 테이블은 수정하지 않았다.
완료 후 원격 이력 11개가 로컬 파일 11개와 고유 버전·SQL 본문 MD5 모두 일치했다.

사용 도구:

- `supabase db query --linked --project-ref ... --file ...`
- `supabase/verify-legacy-baseline.sql`: 사용자 행 데이터 없이 관련 스키마/함수 조회
- `node scripts/verify_migration_baseline.mjs <CLI-export.json>`: 격리 재생 결과 대조
- `npm run audit:migrations`: 이제 예외 없이 엄격 검사 통과
- `node scripts/audit_migrations.mjs --require-rollout`: 원격 검증된 파일 해시와 배포 SQL 일치 확인

`verified-rollout.json`은 실제 원격 조회 결과로 만든 확인 기록이다. 실행할 미래 SQL을
실제 적용 전에 이 파일에 추가하면 안 된다. 기존 적용 SQL은 수정하지 말고 새 버전을 추가한다.
이 환경의 PostgreSQL pooler 직접 연결은 DNS timeout으로 실패했으므로 `db push --dry-run`을
통과했다고 주장하지 않는다. 새 빈 DB의 전체 bootstrap/staging 복제는 별도 작업이다.

## CI 및 배포 개선

- 기존 CI 실패 원인: 백엔드 테스트가 비동기 취소 직후 한 번의 이벤트 루프만 기다리고 종료를
  단정했다. 실제 task 완료를 timeout 안에서 기다리도록 수정했다. 독립 Python 환경 30회 통과.
- 이력 정리가 끝났으므로 CI의 중복 버전 예외를 제거했다. 배포는 전체 검사 통과와 해당 커밋의
  모든 SQL이 검증된 적용 해시에 포함되는 것을 요구한다. 이전의 포괄적인 저장소 변수 대신
  정확한 파일별 증거를 검사하므로 미적용 새 SQL/적용 파일 변조/누락은 배포를 차단한다.
- Actions 검증이 실패했는데 별도 Vercel Git 연동이 같은 커밋 `8ce31e8` 배포 성공을 보고했다.
  두 vercel.json에 `git.deploymentEnabled=false`를 추가하여 해당 우회를 차단하도록 했다.
  Vercel의 실제 Root Directory 및 이 설정의 적용 결과는 배포 후 확인해야 한다.
- 지원하는 루트 설정은 저장소 루트이며, 오래된 frontend 루트 가이드를 수정했다.
- health 응답에 공개 커밋 SHA를 추가했다. Actions CLI 배포가 `APP_COMMIT_SHA`를 주입한다.
  다음 배포 후 운영 도메인의 `commit_sha`와 검사한 SHA를 비교할 수 있다.

변경 전 공개 서비스 읽기 점검:

| 경로 | 결과 |
|---|---|
| /api/health | 200, status ok |
| /api/mock/account (인증 없음) | 401 |
| /api/admin/users (인증 없음) | 403 |

URL: https://stock-ashen-three.vercel.app . 인증 없이 권한 있는 작업을 수행하지 않았다.
기존 health 응답은 SHA를 포함하지 않으므로 당시 운영 도메인의 정확한 커밋은 확인되지 않았다.

계속 필요한 확인: 새 CI/배포 결과, Vercel 프로젝트 설정·배포 자격증명, 승인 세션을 사용한
staging 화면/거래 E2E, 실제 과거 데이터에 기반한 전략 성과 비교. 실거래·운영 계좌 초기화·
추천/가격 재발행·모델 전체 학습은 이번 작업에 포함하지 않았다.

## 원격 검증 결과 추가

코드 커밋 `fb45369`의 GitHub 전체 검사와 배포용 재사용 검사가 모두 통과했다.
기존에 실패하던 백엔드 테스트 및 기본 빌드도 통과했다.
배포는 자격증명으로 프로젝트 조회와 파일 업로드까지 성공했지만 Vercel endpoint가
CLI 41.7.8을 거부하며 47.2.2 이상을 요구했다. npm에는 정확한 47.2.2가 없었으므로
실제 배포된 버전과 Node 요구사항을 조회해 64.5.0(Node >=20)으로 고정했다.
로그: https://github.com/kosj/stock/actions/runs/39275227866/job/118138431461 .
이 실패에서 자격증명 자체는 동작했으며, 프로젝트 root/build 단계는 아직 확인되지 않았다.
