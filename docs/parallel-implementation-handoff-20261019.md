# 전체 리뷰 계획 병렬 구현 인수인계

최신 후속 상태: [2026-10-20 이력 정리·CI/배포 점검](migration-reconciliation-20261020.md).
아래의 과거 중복 이력 미정리/저장소 변수 안내는 그 후속 기록으로 대체된다.

작성: 2026-10-19. 기준 커밋: `4748c3434f58bee8daf81728561ed41de7085ebf`.
이 문서는 `repository-review-20261019.md`의 **후속 구현 상태**다. 리뷰 당시 상태와 구분한다.
코드·SQL·오프라인 테스트를 작성했으며 운영 DB 적용·배포·실거래·모델 전체 학습은 하지 않았다.
위 문장은 최초 구현 시점 기록이다. 이후 운영 DB 적용 결과는 아래 추가 기록을 우선한다.
커밋·푸시 여부는 `git status`와 원격 이력으로 확인한다.
기존 사용자 수정 `ml/hybrid_stacking_ensemble.py`는 이번 변경에 포함하지 않는다.

## 구현 상태

| 리뷰 ID | 반영 내용 | 잔여/운영 조건 |
|---|---|---|
| SEC-01 | 앱 테이블 RLS, anon/authenticated 직접 권한 제거, 위험 RPC 구버전 차단 | staging/실제 grants·외부 소비자 확인 후 적용. 앱은 서버 API/service role 전용 |
| SEC-02/05 | 승인 역할 API 경계, 관리자 공통 가드, 가입/DB 트리거 항상 pending | 기존 관리자 유지. 공개 가입 IP 남용 방어는 신뢰 가능한 배포 경계 확인 필요 |
| SEC-03 | 브라우저 비밀번호/키/토큰 저장 제거 및 기존 저장값 정리, 서버 증권사 설정 | 구형 브라우저 키는 설정 화면에서 서버에 재등록. 선택 API 키는 탭 메모리만 |
| SEC-04, LEG-01/02 | 레거시 내부 비밀키 인증, 사용자 없는 전체 푸시 중단, WS 공유 producer/구독별 전송 | 손상된 섹터·KRX 원본은 복원 전 503. 레거시 실제 사용 여부와 전체 기동 검증 필요 |
| SEC-06 | 입력/스트리밍 본문 상한, 티커 검증, 분석 동시성 3, DB 영속 사용자 quota | 신규 SQL001 필요. 공개 전체 부하 제한은 운영 게이트웨이에서 보완 |
| OPS-01/05 | 기본 Turbopack 빌드 루트, Node24/npm11, root lockfile/clean npm ci | 실제 Vercel 프로젝트 root 설정 확인 |
| OPS-02/03 | 기존 migration 해시 보존/감사, 같은 커밋 검사 후 배포, 운영 적용 확인 변수 | 중복 역사 버전과 원격 적용 이력은 미확인. 독립 Vercel 자동배포 설정 확인 |
| OPS-04 | 승인된 모의계좌별 날짜 작업 큐, lease/owner, 재시도 최대3회, 실패 영수증, 재호출 drain | SQL005 필요. 호출 예산 이후 대기 작업은 DB에 남음; 실패 상태 감시/수동 재시도 |
| TRD-01/02 | 공통 잠금/계좌 세대, 원자적 리셋·현금 조정, 입출금/손익/비용 원장 | 과거 미기록 비용은 복원하지 않음. 도입 시 장부 기준선 공개 |
| TRD-03, UI-01 | 수동 UUID 재사용·실제 영수증, 승인 사용자별 자동매매 로그 페이지 | SQL002 선적용. 구버전 서버 주문 RPC 사용 불가 |
| TRD-04/05 | 표시용/체결용 시세 분리, 실제 거래시각 검증, KRW 계좌 국내6자리만 | Yahoo 공급 불가 시 주문 보류. FX/해외 주문·공휴일 캘린더는 미구현 |
| PERF-01/02 | 캐시 원래 만료 유지·최대500·동시 요청 병합, 사용자/환경/자격증명별 KIS 토큰·잔고 연속조회 | 인스턴스 간 토큰 공유/실제 공급자 smoke·p50/p95 측정은 미실행 |
| PERF-03 일부 | ETF 순위 결과 30초/32키 캐시 및 중복 계산 병합, 프로세스 공통 차트 동시8/대기256 제한 | 서버 인스턴스 간 공통 한도·일괄 사전 적재는 별도 필요 |
| ALG-01/03/04/05 | 페이지 조회·휴일 lag, ETF 동률 평균순위, RSI 경계값, 가격 원자적 발행/CAS/버전 보존 | SQL003 필요. 모든 가격 writer는 발행 RPC 사용; 보존 비용 정책 필요 |
| ALG-02/06 | 미보정 수익률 표시 억제 유지, 가격 revision/PIT 미구현 메타 기록 | 당시 유니버스·기업행위·원본 데이터 확보 후 walk-forward/보정/전략 비교 |
| UI-02 | 없는 푸시 기능을 성공으로 응답하지 않고 비활성 상태 표시 | 실제 사용자별 발송·해제·재시도는 미구현 |
| QA-01/02 | 단위/실제 핸들러/격리 DB 통합 검사, 전체 lint 신규 오류 차단, 역할별 인수인계 | 기존 lint 부채/브라우저 E2E/중복 구현 정리 계속 필요 |

## 운영 적용 순서 — 아직 실행하지 않음

1. 실제 활성 Vercel/Railway/Edge 경로와 DB 프로젝트, 현재 역할·grants·적용 이력을 읽기 전용 확인한다.
2. 백업과 staging 복제로 중복 역사 버전 `20260810`, `20261019`의 **각 SQL 본문** 적용 여부를 대조한다.
   이름만 바꾸거나 `db push`부터 실행하지 않는다. [빌드·이력 runbook](build-ci-runbook.md)을 따른다.
3. 이전 거래 안전성/주문 guard/price_daily 등 필요한 역사 변경이 적용됐는지 확인한 다음 아래 순서 적용:
   - `202610200001_api_security.sql`
   - `202610200002_mock_ledger.sql`
   - `202610200003_price_versions.sql`
   - `202610200004_access_controls.sql`
   - `202610200005_auto_trade_jobs.sql`
4. 서버 `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `BROKER_ENCRYPTION_KEY` 및 비용 설정 확인.
   익명키 서버 폴백은 제거했다. 브라우저에는 공개 anon 키만 둔다.
   레거시를 유지한다면 `LEGACY_INTERNAL_API_SECRET`(32자 이상)와 격리된 호출 경로를 별도로 설정한다.
5. 신규 schema와 **신규 코드 동시 전환**을 staging에서 검증한다. SQL002는 구형 직접 주문을 차단하므로
   배포 전환 중 거래 API를 잠시 중지하는 방식을 사용한다. 구형 코드로 임의 롤백하면 안 된다.
6. GitHub 배포 확인 변수는 실제 준비가 끝났을 때만 설정한다. 독립 Vercel Git 자동 배포 우회도 막는다.
7. 승인 사용자 격리/거래 영수증/원장/시세시각/큐 재시도/저장된 KIS demo 설정을 staging에서 확인한다.
   알림/레거시 손상 기능은 현재 비활성이라는 UI/응답을 확인한다.

`supabase/schema.sql`은 오래된 부트스트랩이다. 업그레이드 DB에 재실행하면 RLS 설정을 되돌릴 수 있다.
DB 변경 전후의 실제 적용 이력과 확인 결과를 이 문서에 추가한다.

## 검증 및 후속 작업

최종 통합 검증 결과:

- Node 테스트 43개 통과(실제 핸들러·정책·격리 DB·전체 마이그레이션 조합 포함).
- Python 모델/데이터/레거시 테스트 13개 통과, 뉴스 회귀 검사 전체 통과.
- 전체 TypeScript 검사와 기본 Turbopack 프로덕션 빌드 통과.
- 전체 lint 기준선: 기존 위반 109개, 증가 0개. `git diff --check` 통과.
- 고정 lockfile로 별도 작업 디렉터리 `npm ci` 재현 확인.
- 역사 파일 해시 및 알려진 중복 허용 감사 통과. 원격 이력 확인은 아님.

```bash
npm ci
npm run test:safety
npm run typecheck
npm run lint:baseline
node scripts/audit_migrations.mjs --allow-known-duplicates
npm run build
git diff --check
```

임시 Supabase URL/키로 기본 프로덕션 빌드 검증; 운영 서비스 호출이 아닌 컴파일 검증이다.
전체 lint는 아직 깨끗하지 않다. baseline 검사는 기존 부채의 증가를 차단하며 기존 오류를 면제/해결했다고
주장하지 않는다. 엄격한 migration audit 실패는 알려진 역사 중복을 해결하기 전 의도된 상태다.

다음 우선순위는 운영 이력/적용 확인 → staging 통합/E2E → 실제 시점 데이터 확보 및 동일 엔진 성과 비교다.
ETF 요청 사전 계산/적재, 전체 요청 deadline/취소, 화면 polling·전체 lint 정리는 남은 성능/유지보수 작업이다.
현재 변경으로 실제 투자 수익이나 응답시간이 개선됐다는 실측 근거는 없다.

세부 문서: [거래 안전성](trading-safety-handoff.md), [모의 원장](mock-ledger-20261020.md),
[모델/가격](model-data-handoff-20261019.md), [빌드/CI](build-ci-runbook.md),
[자격증명](credential-security.md), [레거시 서버](../backend/SECURITY_HANDOFF.md).

## 운영 DB 적용 완료 — 2026-10-19 KST 추가 기록

사용자의 직접 적용 요청으로 Supabase CLI 2.121.0을 통해 `kosj's Project`
(`enunwzitobtgrelzdudd`, ap-southeast-1)에 신규 마이그레이션 5개를 적용했다.
적용 버전은 `202610200001`부터 `202610200005`까지이며,
`supabase_migrations.schema_migrations`에서 다섯 이력을 재조회했다.

- 적용 전 운영 스키마/함수/권한과 변경 관련 계좌·원장 데이터의 제한적 스냅샷을
  작업 환경에 확보했다. 전체 DB 백업이나 장기 보존 백업을 생성한 것은 아니다.
- 기존 lease/발행/guarded buy/sell 함수와 필요한 테이블이 이미 존재함을 확인했다.
  CLI 이력 테이블은 없었으므로 과거 파일 전체를 재실행하거나 적용됐다고 임의 등록하지 않았다.
- CLI `db query --linked --project-ref ... --file ...`로 신규 5개 SQL을 순서대로 실행했다.
  외부 단일 트랜잭션과 advisory/table lock, lock/statement timeout을 사용했다.
  각 SQL의 DDL/DML과 해당 원문·버전 이력 기록을 같은 트랜잭션에 포함했다.
  과거 중복 파일 이름 변경·migration repair·`db push`는 실행하지 않았다.
- 기존 계좌 2개, 보유 10개, 거래 107개, 실행 로그 40개, 가격 114,422개,
  추천 10,234개 및 계좌 현금 합계가 적용 전후 동일했다.
- 장부 기준선/계좌 세대 초기화, 신규 가입 pending 트리거를 확인했다.
- 대상 25개 테이블의 RLS, anon/authenticated 직접 접근 차단과 서비스 조회 권한,
  신규 RPC 9개의 서비스 전용 실행 권한, 구형 매수/매도 RPC 서비스 실행 차단을 확인했다.
- 실제 `service_role`에서 계좌 snapshot/가격 snapshot **읽기만** 검증했다.
  실제 주문, 계좌 초기화, 추천 발행/학습, 가격 교체, 큐 적재/처리는 실행하지 않았다.

CLI 로그인은 `SUPABASE_NO_KEYRING=1`로 완료했다. 기본 OS 키 저장소는 이 환경에서
다음 명령이 인증을 읽지 못했다. 인증 파일은 저장소 밖이며 토큰은 문서/커밋에 포함하지 않는다.
직접 pooler 연결은 DNS timeout이 발생했다. 2.121.0의 linked query는 Management API를
사용하지만 사전 DB resolver가 임시 DB 접속을 시도한다. 해당 SQL 실행에 사용되지 않는
`SUPABASE_DB_PASSWORD` placeholder를 CLI 프로세스에만 지정해 이 사전 연결을 피했다.
이 placeholder는 실제 DB 비밀번호가 아니며 `db push/dump`의 직접 연결에 사용하면 안 된다.

**남은 운영 작업:** 과거 수동 적용분/중복 파일의 정식 baseline 이력 대조, staging/E2E,
서버 환경변수·Vercel 실제 배포 확인. `MIGRATION_HISTORY_RECONCILED`는 변경하지 않았다.
이번 5개 적용만으로 엄격한 migration audit나 향후 무조건적인 `db push`가 준비된 것은 아니다.
