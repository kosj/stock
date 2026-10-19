# Stock 전체 코드 리뷰 및 개선 실행 계획

기준: 2026-10-19 KST, `master` 커밋 `4748c3434f58bee8daf81728561ed41de7085ebf`.
목적: 기능 정확성·보안·데이터 신뢰성·성능·운영 가능성의 개선 목록과 실행 순서 수립.
이번 작업은 리뷰 및 문서 작성이다. 애플리케이션 코드/DB/배포 설정을 수정하지 않았다.

## 1. 결론

모델 추가나 UI 미세 최적화보다 **권한 경계 → 배포/스키마 기준선 → 모의투자 원장 →
체결 가능한 시세 → 실제 전략 검증 → 성능 측정·최적화** 순서가 맞다.
앞서 개선한 순수 거래 엔진과 DB 통합 테스트는 좋은 기반이나, 웹 API·수동 거래·리셋·
화면 손익·별도 백엔드까지 같은 정책으로 묶이지 않은 부분이 남아 있다.

권한/RLS 문제는 특히 중요하다. 단, 운영 DB의 실제 GRANT/RLS 상태, Railway 노출 여부,
Supabase Edge Function 배포 여부는 이번 리뷰에서 확인하지 않았다.
소스에 위험한 경로가 있다는 사실과 운영에서 악용 가능하다는 판단을 구분한다.

## 2. 범위와 검증 결과

- Next.js: API route 파일 66개, 페이지 파일 25개. 인증·포트폴리오·모의투자·시세·분석·알림
  주요 경로와 공용 서비스, 설정 및 배포 워크플로를 정적 검토했다.
- Python: `backend`와 `scripts`의 47개 파일을 인코딩 감지 후 구문 검사했다.
- 프런트 전체 ESLint: 203개 파일, **오류 97개 / 경고 28개**.
  오류: `no-explicit-any` 90, `set-state-in-effect` 5, `prefer-const` 2.
- TypeScript 전체 타입 검사 통과.
- 엔진/정책 테스트 13개, PostgreSQL WASM 통합 테스트 1개, 모델 안전성 테스트 3개 통과.
- 뉴스 큐레이션 회귀 스크립트의 모든 단정 통과.
- 기본 `npm run build` 실패: Turbopack이 hoisted Next 패키지와 워크스페이스 루트를 찾지 못함.
- 진단용 `next build --webpack`은 전체 빌드 통과. 빌드에는 가짜 Supabase URL/키를 사용했다.
  운영 환경의 빌드·연결·로그인·시세 정상 여부를 뜻하지 않는다.
- 순수 함수 재현: ETF 동점 순위 편향, 상승 시계열 RSI NaN 확인.
- 실제 운영 DB 접근, 실거래/모의거래 API 호출, 마이그레이션, 배포, 부하 테스트는 하지 않았다.
- 기존 사용자 변경인 `ml/hybrid_stacking_ensemble.py`는 수정하지 않았으며,
  이번 운영 모델 검토는 실제 워크플로가 실행하는 `scripts/hybrid_ensemble.py`를 대상으로 했다.
- 전수 정적 검사는 수행했지만 모든 실행 분기와 운영 환경을 검증한 보안 감사는 아니다.

## 3. 개선 목록

우선순위: P0=운영 노출 확인/차단 최우선, P1=정확성·안정성 우선 수정,
P2=신뢰성·성능·유지보수 개선, P3=후속 정리.
표의 파일 위치는 저장소 루트 기준이다. 각 항목의 완료 기준은 뒤의 단계별 계획을 따른다.

| ID | 우선 | 발견/개선 항목 | 코드 근거 | 영향 및 조치 |
|---|---|---|---|---|
| SEC-01 | P0, 노출 조건부 | 사용자 데이터 테이블의 RLS 비활성화 및 기존 RPC 권한 경계 | `supabase/schema.sql:384`, `:389`, `:145` | 일반/익명 역할에 테이블·RPC 권한이 있으면 Next API를 우회할 수 있음. 운영 권한 목록부터 확인하고 소유자 RLS와 서버 전용 RPC 권한 적용. 최근 주문 RPC만 강화했다고 전체 DB가 보호된 것은 아님. |
| SEC-02 | P1 | 승인 대기/거절 계정의 API 접근 | `frontend/middleware.ts:12`, `frontend/lib/server/require-user.ts:31` | API는 페이지 미들웨어 밖이며 getUser만 확인. 승인된 role까지 검증하는 공통 가드 필요. |
| SEC-03 | P1 | 브라우저에 복호화 비밀번호 평문 영구 저장 | `frontend/lib/apiConfig.ts:58`, `:69`, `:172` | 암호문과 복호화 수단이 같은 저장소에 있음. 구형 자격증명 경로 제거, 서버 보관 통합. 외부 API 키의 평문 localStorage도 함께 정리. 실제 XSS 발생은 확인하지 않음. |
| SEC-04 | P1, 배포 조건부 | 별도 FastAPI의 인증·소유권 부재 및 전체 알림 전송 | `backend/app/api/portfolio.py:34`, `backend/app/models/portfolio.py`, `backend/app/services/alert_service.py:72` | 모델에 user_id가 없고 CRUD 인증이 없음. 외부 공개 여부 확인 후 폐기/내부 격리/동일 인증 체계 편입 결정. 사용자 알림을 전체 구독에 보내지 않도록 수정. |
| SEC-05 | P1, 초기화 조건부 | 입력 이메일만으로 관리자 역할 지정 | `frontend/app/api/auth/signup/route.ts:32`, `:40` | 지정 관리자 이메일이 미가입이면 소유권 검증 없이 role 부여할 수 있음. 일반 가입에서 admin 지정 금지, 별도 bootstrap/초대 절차 사용. 기존 계정의 비밀번호를 바꿀 수 있다는 의미는 아님. |
| SEC-06 | P1 | 무인증 분석 API의 배치 상한·입력 검증·요청량 제한 부족 | `frontend/app/api/analysis/tft/route.ts:25`, `frontend/app/api/analysis/entry-point/route.ts` | 무제한 배열로 외부 호출/CPU 증폭 가능. 공개 데이터 API 여부와 별개로 본문 크기·티커 형식·개수·동시성·사용자/IP rate limit 필요. |
| OPS-01 | P1 | 기본 빌드의 워크스페이스 루트 인식 실패 | `frontend/next.config.ts`, 루트 `package.json` | 이 체크아웃에서 기본 빌드 재현 실패, Webpack은 통과. Turbopack root·패키지 hoist·Vercel root/buildCommand 조합을 하나로 고정하고 clean checkout 검증. 운영 Vercel 실패 여부는 미확인. |
| OPS-02 | P1 | 마이그레이션 버전 중복 및 스키마 진입점 분산 | `supabase/migrations`, `supabase/schema.sql`, `frontend/supabase-migration.sql` | `20260810`, `20261019` 접두어가 각각 2개. CLI 적용 순서·이력 충돌 위험. 고유 버전+기준 스키마 필요. 이미 적용한 이력을 확인하기 전 파일명부터 바꾸면 안 됨. |
| OPS-03 | P1 | 테스트 성공과 프로덕션 배포가 연결되지 않음 | `.github/workflows/vercel-deploy.yml`, `trading-safety-tests.yml` | master push가 별도 워크플로로 배포되어 검증 실패와 동시에 배포될 수 있음. 필수 검사·환경 승인·검증된 커밋 배포·마이그레이션 선행 확인 필요. |
| OPS-04 | P1 | 자동매매 이월 사용자를 영속 큐에 저장하지 않음 | `frontend/app/api/cron/auto-trade/route.ts:51`, `:63` | 배열에만 이월 기록. 매번 같은 순서면 후순위 계정이 계속 누락될 수 있음. 작업 테이블/체크포인트/재시도/공정한 선택 순서 필요. 시작 후 개별 작업이 예산을 넘기는 경우도 통제. |
| OPS-05 | P2 | 의존성/실행 환경 재현성 부족 | `.gitignore`, `frontend/package.json`, `scripts/requirements.txt`, CI | lockfile 제외, 버전 범위/미고정 의존성, Node 20/24 혼용. lockfile 커밋과 npm ci, Python 잠금·지원 런타임·워크플로 버전 고정. |
| TRD-01 | P1 | 계좌 리셋이 원자적이지 않고 오류도 무시 | `frontend/app/api/mock/account/reset/route.ts:21` | 포지션 삭제·체결 삭제·잔고 초기화가 각각 실행되고 항상 성공 반환. 자동매매/수동거래와 경합 시 불일치 가능. 계좌 잠금과 단일 reset RPC, epoch 기반 주문 키 필요. |
| TRD-02 | P1 | ‘총 손익’이 실제로는 보유 종목 평가손익 | `frontend/app/api/mock/account/route.ts:75`, `frontend/components/mock/MockTradingPage.tsx:238` | 전량 매도하면 총 손익 0으로 보임. 현금 수동 수정도 입출금 이력이 없어 수익률 계산 불가능. 실현·미실현·비용·입출금 원장과 계좌 수익률을 분리. |
| TRD-03 | P1 | 수동 거래 UI에 주문 멱등키·실제 체결 정보 반영 누락 | `frontend/lib/api.ts:101`, `frontend/components/mock/MockTradeModal.tsx:100` | 서버는 선택적 키를 받지만 호출부가 전달하지 않음. 성공 안내가 실제 체결가 대신 화면 시세를 사용하고 비용을 뺀 금액으로 주문 가능 여부 계산. 주문 UUID 재사용 및 체결 영수증 기반 표시 필요. |
| TRD-04 | P1 | ‘표시 가능한 가격’과 ‘체결 가능한 가격’ 소스 선택이 분리되지 않음 | `frontend/lib/server/yahoo-finance.ts:426`, `frontend/lib/server/adapters/yahoo-market-data-adapter.ts:16` | Naver가 먼저 응답하면 거래시각 없는 가격을 반환·캐시, 엔진은 올바르게 거부함. 다른 공급자에 체결 가능한 값이 있어도 놓칠 수 있음. 신선도 조건을 만족하는 공급자 전용 경로 필요. 기존 fail-closed 검사를 제거하면 안 됨. |
| TRD-05 | P2 | 국내/해외 자산의 통화·거래소 계약 미정의 | `frontend/lib/core/ports/market-data-port.ts`, `frontend/components/mock/MockTradeModal.tsx` | UI는 AAPL 등 검색을 암시하지만 계좌·시계·수수료는 원화/국내 기준. 국내 전용 명시·차단 또는 currency/exchange/FX 도입을 먼저 결정. |
| ALG-01 | P1 | 추천 성과 조회에 PostgREST 페이지네이션 없음 | `scripts/backtest_recommendations.py:81` | limit=100000만으로 서버 최대행 제한을 넘길 수 없음. 이력 일부만 측정될 위험. 날짜/티커 안정 정렬, 페이지 분할, 예상 행 수 검증 필요. `price_store.read`의 페이지 처리 방식과 일관화. |
| ALG-02 | P1 | 최종 추천 점수·전략의 검증과 수익률 보정 미완료 | `scripts/hybrid_ensemble.py:379`, `:1018`, `:1098`, `frontend/lib/core/replay.ts` | 현재 품질 게이트는 모델 순위 IC이고 최종 감성/변동성 혼합·필터·5종목 전략 전체의 수익을 검증하지 않음. 검증된 OOF 성과와 비용 반영 실제 전략을 따로 측정. 미보정 수익률 공개 API 필드도 계약 정리. |
| ALG-03 | P2, 재현 | ETF 동점 값에 서로 다른 순위 점수 부여 | `frontend/lib/server/etf-ranking-service.ts:94`, `:99` | `[0,0,0]`도 서로 다른 z 점수. 평균 순위 처리와 입력 순서 불변성 테스트 필요. |
| ALG-04 | P2, 재현 | 연속 상승 구간 RSI가 NaN | `scripts/hybrid_ensemble.py:176` | loss=0을 NaN으로 바꿔 완전 상승 시계열을 결손 처리. 상승·하락·정체 경계값 정책과 테스트 필요. |
| ALG-05 | P2 | 기업행위 재적재의 원자성·데이터 버전 부족 | `scripts/price_store.py:199`, `:201` | 삭제 후 여러 청크 삽입 실패 시 원본 유실/부분 적재. 반환값은 fresh/resync로 보여 다음 실행과 다를 수 있음. 버전별 staging→검증→포인터 전환, 기업행위 이력·입력 스냅샷 지문 저장. |
| ALG-06 | P2 | 현재 고정 유니버스로 과거 성과 평가 | `scripts/universe.py`, `scripts/hybrid_ensemble.py` | 당시 편입·상장폐지·종목/시장 변경 이력이 없어 생존/선택 편향을 분리하기 어려움. point-in-time 유니버스와 종목 마스터 버전 도입. |
| PERF-01 | P2 | 캐시 만료 재설정·동일 요청 중복·메모리 상한 부재 | `frontend/lib/server/yahoo-finance.ts:103`, `_l1` | L2 잔여 TTL 대신 전체 TTL로 L1을 다시 설정. 동시 miss에서 외부 호출 중복, 임의 티커/검색키 누적으로 Map 증가. 원래 expiry 보존, single-flight, LRU/최대 크기 및 관측 지표 필요. |
| PERF-02 | P2 | KIS 토큰 캐시가 요청별 인스턴스에 묶임 | `frontend/lib/server/providers.ts:103`, API의 `createBrokerProvider` | 요청마다 토큰 발급을 반복할 수 있음. 사용자·브로커·환경·자격증명 버전별 암호화 캐시와 발급 잠금 필요. 사용자 간 토큰 혼용 금지. 잔고 연속조회 페이지도 구현. |
| PERF-03 | P2 | 분석·ETF 일봉 수집의 요청 중 fan-out | `frontend/lib/server/etf-ranking-service.ts`, `frontend/app/api/portfolio/[id]/auto-fill/route.ts` | 요청마다 많은 외부 호출·분석. 일봉 배치 적재 및 사전 계산, 요청 내 중복 제거, bounded concurrency/전체 deadline 도입. 개선율은 실제 측정 전 주장하지 않음. |
| UI-01 | P1 | 자동매매 로그 조회 API 없음 | `frontend/lib/api.ts:105`, `frontend/app/api/mock/auto-trade/run/route.ts` | `/api/mock/auto-trade/logs` 호출은 있으나 route 없음. 사용자 스코프·페이지네이션이 있는 API와 빈 결과/오류 구분 필요. |
| UI-02 | P2 | 알림 구독 성공 응답이 실제 저장을 하지 않음 | `frontend/app/api/push/subscribe/route.ts:7`, `:12` | 데이터 저장이 주석인데 201 성공. 알림을 믿고 사용할 수 없음. 실제 사용자별 구독/구독해제/전송 파이프라인 또는 미구현 표시. |
| LEG-01 | P1, 재현 | Python 백엔드 모듈 2개 문법/인코딩 손상 | `backend/app/services/sector_service.py:17`, `backend/app/services/krx_service.py:35` | 두 모듈은 main에서 import되는 API가 참조하므로 이 소스로 백엔드 정상 기동 불가. 복원 또는 백엔드 퇴역 여부를 결정하고 전체 Python 구문 검사를 CI에 추가. |
| LEG-02 | P2, 배포 조건부 | WebSocket 수집/전송의 중복 증폭 | `backend/app/ws/prices.py:73`, `:79` | 연결마다 가격을 수집하고 같은 티커의 전체 연결에 다시 broadcast. N 연결에서 전송 횟수가 N² 형태로 증가할 수 있음. 티커별 공유 producer와 구독자 fan-out으로 변경. 프런트 실시간 훅은 현재 비활성. |
| QA-01 | P2 | 전체 lint 실패 및 변경 범위에 따른 CI 공백 | `frontend/eslint.config.mjs`, `trading-safety-tests.yml` | 기존 핵심 테스트가 통과해도 전체 품질/화면/API 변경 검증은 보장되지 않음. lint 기준선·API 계약 테스트·권한 테스트·핵심 E2E 추가. any 제거만을 성능 최적화로 취급하지 않음. |
| QA-02 | P3 | 중복 구현·이름·문서의 제품 계약 불일치 | `backend`, `frontend/lib/server`, `frontend/README.md`, `frontend/lib/websocket.ts` | 구형/현재 서비스 경계와 기능 가용 상태 불분명. 활성 배포 목록·API 스키마·구현/미구현 상태·환경변수·운영 runbook을 한곳에 정리. |

총 31개 항목이다. 동일 원인에 묶여 있는 항목은 독립 PR로 나누되 완료 기준을 함께 검증한다.

## 4. 주요 재현과 판정 근거

### A. 손익 표시 오류

현재 `total_pnl = 보유평가금액 - 보유매입금액`이다. 예를 들어 실현손익이 +100만원이어도
전량 매도해 보유 종목이 없으면 총 손익은 0으로 표시된다. 이는 수익률 최적화 이전에
고쳐야 할 회계/표시 오류다. 계좌 현금 임의 조정을 허용하므로 초기자금 대비 차액만으로
바꾸는 것도 충분하지 않다. 별도 현금흐름 원장과 실현/미실현 구분이 필요하다.

### B. 수동 거래 중복 및 체결 표시

모달은 `api.mock.trade`에 UUID를 보내지 않으며 응답의 실제 가격/금액도 사용하지 않는다.
네트워크 재시도·재전송과 가격 변경·비용 차감이 있는 환경에서 같은 주문이 중복되거나
성공 안내 가격이 체결 기록과 달라질 수 있다. 버튼 disabled만으로 서버 멱등성을 대신할 수 없다.

### C. ETF 동점 편향

실제 `rankZ` 함수를 추출해 실행한 결과:

```text
rankZ([0,0,0]) = [-1.1546010853, 0, 1.1546010853]
rankZ([1,1,2]) = [-1.1546010853, 0, 1.1546010853]
```

같은 값은 같은 평균 순위를 받아야 한다. 안정 정렬은 동점 데이터의 입력 순서를
재현할 뿐 동점 점수를 같게 만들지 않는다. 최종 순위가 필요한 경우 동일 점수 후의
결정적 tie-breaker와 모델 점수 계산을 분리한다.

### D. RSI 경계값

실제 `_rsi(pd.Series(np.arange(1,101,dtype=float)))` 결과는 마지막 NaN, 유효 표본 0개다.
보통 손실이 전혀 없는 상승 구간은 RSI 상단으로 표현해야 하지만 결손 처리되고 있다.
정체 구간의 0/0은 별도 중립 정책을 정한 뒤 일관되게 처리한다.

### E. 기본 빌드와 대체 빌드

동일한 임시 Supabase URL/키를 주입한 환경에서 기본 Turbopack 빌드는 다음 오류로 실패했다.

```text
Next.js inferred your workspace root, but it may not be correct.
We couldn't find the Next.js package (next/package.json) from the project directory .../frontend/app
```

같은 체크아웃에서 `next build --webpack`은 전체 빌드를 통과했다. 앱 전체를 빌드 불가능으로
단정하지 말고, 기본 빌드 도구·루트 탐지·설치 형태의 재현성 문제로 분류한다.
수정 시 Turbopack root를 명시할지, 검증된 Webpack으로 임시 고정할지 선택하고 CI와
실제 배포를 동일하게 맞춘다. middleware→proxy는 별도 호환성 정리 항목이다.

## 5. 실행 계획

### 단계 0 — 운영 기준선 확인 / 약 0.5~1일

대상: SEC-01, SEC-04, OPS-01, OPS-02, LEG-01.

1. 실제 활성 경로를 확정: Vercel 프런트/API, Supabase DB/Edge Function, Railway 백엔드.
2. DB 관리자 읽기 전용 조회로 RLS·GRANT·RPC 실행 권한·스키마/마이그레이션 이력 확인.
3. 기존 수동 적용 여부를 확인하고 migration 버전을 고유화할 방법 확정.
   현재 CLI 설치만으로 `db push`부터 실행하지 않는다.
4. clean checkout + 고정 런타임으로 기본 빌드 기준선 확보.
5. 백엔드를 유지하면 손상된 파일을 원본에서 복원; 미사용이면 외부 노출을 중지하는 계획 수립.

완료 기준: 활성 서비스/데이터 소유권 표, DB 현재 상태, 재현 가능한 빌드 명령,
기존 데이터 보존을 포함한 배포·마이그레이션 순서가 문서화됨.

### 단계 1 — 접근 제어와 배포 게이트 / 약 2~3일

대상: SEC-01~06, OPS-03, QA-01 일부.

1. `requireApprovedUser`/`requireAdmin` 가드로 API 정책 통일.
2. 일반 가입에서 admin 부여 제거; 역할은 서버 관리자 작업으로만 변경.
3. 사용자 테이블의 RLS와 RPC 실행 권한을 staging에서 먼저 검증 후 적용.
4. 서버 자격증명 보관으로 통합하고 구형 localStorage 비밀번호/키 경로 폐기·이행.
5. 배치 입력 스키마, 크기 상한, 동시성/요청 제한, 오류 응답 규칙 도입.
6. CI 성공 커밋만 배포하도록 연결. 자동 배포가 검사를 앞서지 않도록 설정.

완료 기준: 익명/대기/거절/승인 사용자/관리자의 허용·차단 테스트,
다른 사용자 자원 접근 403/404 테스트, 익명 DB 직접 접근 차단,
잘못된/과도한 배치 요청 거부, 실패한 검사로 프로덕션 배포 불가.

### 단계 2 — 모의투자 원장과 거래 일관성 / 약 2~3일

대상: TRD-01~03, UI-01, OPS-04, TRD-05 정책 결정.

1. 실현손익·미실현손익·비용·입출금을 분리하는 계좌 원장/API 정의.
2. 리셋/수동 주문/자동 주문이 같은 계좌 잠금 정책을 따르도록 통합.
3. 계좌 reset epoch를 주문 키와 분리 기록해 같은 날 리셋 후 과거 키 충돌 방지.
4. 수동 주문의 UUID 생성·재시도 재사용·서버 체결 영수증 표시.
5. 사용자별 자동매매 로그 조회 및 페이지네이션 구현.
6. 자동매매 작업의 큐/체크포인트·재시도·순서 공정성 도입.

완료 기준: 전량 매도 후에도 실현손익 보존, 입출금이 수익으로 계산되지 않음,
리셋 도중 실패/동시 주문에서도 자산 보존, 재전송 중복 체결 없음,
화면 금액=서버 체결 기록, 이월 계정이 다음 실행에서 누락되지 않음.

### 단계 3 — 시세·캐시·증권사 연동 / 약 2~3일

대상: TRD-04, PERF-01~03, TRD-05 구현.

1. Quote 계약을 source/exchange/currency/tradedAt/fetchedAt/stale로 명확화.
2. 표시용 시세와 실행 가능한 시세 조회 분리. 실거래시각을 모르는 가격은 실행에 사용하지 않음.
3. 캐시의 원래 만료시각 보존 + single-flight + 최대 크기/eviction.
4. 사용자별 KIS 토큰 캐시/동시 발급 방지, 계좌 잔고 연속조회 구현.
5. ETF 일봉과 공통 지표를 배치 적재/사전 계산하고 HTTP 요청은 결과 중심으로 읽음.
6. 전 경로에 요청 전체 deadline과 취소, 장외 폴링 축소 적용.

완료 기준: 공급자별 거래시각 정상/없음/지연·거래정지·휴장 테스트,
같은 티커 동시 요청에서 외부 조회 중복 억제, 사용자 토큰 격리,
콜드/웜 p50·p95와 외부 호출 수·DB 왕복·캐시 hit ratio의 전후 비교.
현재 성능 수치는 측정하지 않았으므로 감소율 목표는 기준선 수집 후 정한다.

### 단계 4 — 모델/추천 품질 검증 / 약 3~5일 + 데이터 확보 기간

대상: ALG-01~06.

1. 이력 조회 페이지네이션과 행 수 확인을 먼저 고쳐 측정기를 신뢰할 수 있게 함.
2. ETF 평균 순위, RSI 경계값, 학습/추론의 결손·정규화 일관성 테스트.
3. 당시 유니버스·생성 완료시각·원시/조정 가격·기업행위를 버전별 보존.
4. 최종 혼합 점수/필터와 실제 5종목 엔진을 비용·세금·시세 제약 포함해 리플레이.
5. 시간순 학습/보정/최종 평가 구간 분리. 최종 평가 구간으로 임계값을 고르지 않음.
6. 모델 원점수의 예측 확신과 실제 수익의 관계를 보정하고 신뢰구간/표본 수 보고.
   검증 전에는 현재의 상대 매력도 표시를 유지하고 수익률로 다시 포장하지 않음.
7. 수급·감성·변동성 혼합의 개별 기여를 제거 실험으로 비교한 뒤 가중치/손절 변경 결정.

완료 기준: 같은 입력의 재현성, 미래 참조 방지 테스트,
비용 차감 후 수익·최대낙폭·회전율·시장 대비 성과·데이터 커버리지·평가 기간 보고.
현재 성과보다 개선되었다는 결론은 실측 없이는 내리지 않는다.

### 단계 5 — 기능 완성도와 유지보수 / 약 2~3일

대상: UI-02, LEG-02, QA-01/02, OPS-05.

1. 알림을 사용자별 저장·해제·실패 재시도까지 구현하거나 미구현 상태를 명시.
2. WebSocket은 실제 필요성이 확인되면 티커별 공유 producer로 구현; 아니라면 비활성 UI 정리.
3. lint 오류를 파일/업무 단위로 줄이고 새 오류 유입을 먼저 차단. 포트폴리오 화면의
   33개 any 오류부터 API DTO로 교체. effect 수정은 동작 회귀 확인 후 진행.
4. lockfile/런타임/CI 범위 고정, API·권한·화면 E2E를 필수 검사에 편입.
5. 사용하지 않는 백엔드/브라우저 키 경로/중복 지표 구현을 제거하고 README/runbook 갱신.

완료 기준: 지원한다고 표시된 기능이 실제 동작하거나 가용 상태가 명확함,
전체 lint·타입·구문·단위·통합·중요 E2E 통과, 새 작업 공간에서 설치/빌드/테스트 재현.

소요 기간은 저장소 구조를 기준으로 한 1인 개발의 거친 추정이다. 데이터 준비,
외부 계정 권한/승인, 운영 확인 시간은 포함하지 않으며 실제 수정 범위에 따라 조정한다.

## 6. 첫 번째 구현 묶음 제안

권장 시작 범위는 **SEC-02/05/06 + UI-01 + OPS-01/02의 기준선 정리**다.
RLS/운영 마이그레이션은 현재 DB 상태 확인 후 별도 적용 절차로 진행한다.
다음 묶음에서 TRD-01~03의 거래/원장 일관성을 고친다.
API 경계와 회계가 흔들리는 상태에서 모델 가중치나 매수 조건을 먼저 바꾸지 않는다.

위 문서는 최초 리뷰 당시 기록이다. 이후 사용자 요청으로 병렬 구현을 진행했다.
최신 구현·검증·잔여 작업은 [병렬 구현 인수인계](parallel-implementation-handoff-20261019.md)를 참조한다.
