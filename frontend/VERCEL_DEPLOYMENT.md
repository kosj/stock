# Vercel 배포 가이드

현재 배포·마이그레이션 절차의 기준은
[운영 runbook](../docs/build-ci-runbook.md)이다. 이 문서는 프론트엔드 프로젝트
루트 설정과 확인 경로만 안내한다.

## 지원하는 저장소 루트 구성

GitHub Actions에서 저장소 체크아웃을 업로드할 때는 다음 구성을 사용한다.

| 항목 | 설정 |
| --- | --- |
| Framework | Next.js |
| Vercel Root Directory | 저장소 루트 (`.` 또는 빈 값) |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `frontend/.next` |
| 패키지 잠금 | 저장소 루트 `package-lock.json` |
| Node.js | 24 |

저장소 루트의 `vercel.json`과 npm workspace 구성이 위 설정을 정의한다.
`frontend/next.config.ts`는 Turbopack과 파일 추적의 기준을 저장소 루트로
지정하여 상위 `node_modules`에 설치된 의존성을 찾는다.

기존 `frontend/vercel.json`은 Root Directory를 `frontend`로 지정한 별도
프로젝트를 위한 구성이다. 연결된 Vercel 프로젝트가 실제로 어느 루트를
사용하는지는 공개 커밋 상태만으로 확인되지 않았다. 기존 프론트엔드 루트
프로젝트와 위 저장소 루트 구성을 섞지 말고, 프로젝트 설정과 staging 빌드로
설치·출력 경로를 확인한 뒤 운영 구성을 전환한다.

## 배포 검증

운영 DB 적용 이력과 필수 마이그레이션을 먼저 확인하고 runbook에 따른
검증을 완료한 커밋을 배포한다. Vercel의 독립 Git 자동 배포가 활성화되어
있으면 GitHub Actions 검증을 우회할 수 있으므로 두 배포 경로의 설정도
확인한다. 재배포만으로 DB 마이그레이션이 적용되지는 않는다.

저장소의 `.github/workflows/recommendation-monitor.yml`과
`smoke-realestate.yml`에서 사용하는 공개 앱 주소는
`https://stock-ashen-three.vercel.app`이다. 읽기 전용 상태 확인 경로는
[`/api/health`](https://stock-ashen-three.vercel.app/api/health)이며, 성공 응답은
HTTP 200과 `{"status":"ok","version":"1.0.0"}`이다.

이 상태 응답은 프로세스 응답 여부만 확인한다. DB 마이그레이션 적용,
인증·권한, 추천 품질, 주문 실행, 배포 커밋 SHA를 검증하지 않는다.
실제 운영 별칭과 배포 SHA는 Vercel 프로젝트에서 별도로 확인한다.

## 로컬 검증

저장소 루트에서 Node 24와 npm 11을 사용해 `npm ci`, `npm run typecheck`,
`npm run lint:baseline`, `npm run test:safety`, `npm run build`를 실행한다.
Python 테스트 의존성과 환경변수 설정은 운영 runbook을 따른다.
개발 서버는 저장소 루트에서 `npm run dev`로 실행한다.

현재 웹 클라이언트는 같은 배포의 `/api`를 사용한다. 별도 Python backend는
레거시 내부 서비스이며, `NEXT_PUBLIC_BACKEND_URL` 설정만으로 현재
클라이언트의 API 경로가 전환된다고 가정하지 않는다.
