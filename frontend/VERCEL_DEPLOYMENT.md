# Vercel 배포 가이드

## 개요

본 프로젝트는 다음과 같이 구성됩니다:
- **프론트엔드**: Next.js + Vercel (무료 호스팅)
- **백엔드**: Python FastAPI (Railway 또는 다른 서비스)

## 1. 백엔드 서비스 준비

### 옵션 A: Railway 사용 (권장)

1. [Railway.app](https://railway.app)에서 회원가입
2. GitHub 저장소 연결
3. `backend` 디렉토리로 배포
4. 배포 후 할당된 URL 기록 (예: `https://your-app-railway.app`)

### 옵션 B: 다른 서비스 (Render, Heroku 등)

- 배포 후 백엔드 URL 기록 필요

## 2. Vercel 프론트엔드 배포

### Step 1: Vercel에 프로젝트 연결

1. [Vercel.com](https://vercel.com)에 로그인 또는 회원가입
2. "New Project" 클릭
3. GitHub 저장소 선택
4. Root Directory를 `frontend`로 설정
5. "Deploy" 클릭

### Step 2: 환경 변수 설정

배포 후 Settings → Environment Variables에서 다음 추가:

| 변수명 | 값 | 설명 |
|---------|-----|------|
| `NEXT_PUBLIC_BACKEND_URL` | `https://your-app-railway.app` | 백엔드 서버 주소 |

**주의**: `NEXT_PUBLIC_` 접두사가 필요합니다. (프론트엔드에서 접근 가능)

### Step 3: 배포 재시작

환경 변수 설정 후 Vercel 대시보드에서:
1. "Deployments" 클릭
2. 최신 배포의 "..." 메뉴 → "Redeploy" 선택

## 3. CLI를 사용한 배포 (선택사항)

### Vercel CLI 설치 및 배포

```bash
npm i -g vercel
cd frontend
vercel --prod --env NEXT_PUBLIC_BACKEND_URL=https://your-app-railway.app
```

## 4. 배포 확인

### API 연결 확인

배포 완료 후 확인 항목:

```bash
# 프론트엔드 헬스 체크
curl https://your-domain.vercel.app/api/health

# 백엔드 연결 확인
curl "https://your-domain.vercel.app/api/krx"
```

### 수동 테스트

1. 브라우저에서 https://your-domain.vercel.app 접속
2. "국내증시 통계" 메뉴 클릭
3. 데이터 로드 확인

## 5. 트러블슈팅

### "Backend not configured" 에러

```
NEXT_PUBLIC_BACKEND_URL 환경 변수가 설정되지 않았습니다.
```

**해결 방법**:
1. Vercel 대시보드 → Settings → Environment Variables
2. `NEXT_PUBLIC_BACKEND_URL` 추가
3. Redeploy

### CORS 에러

백엔드 서버의 CORS 설정 확인:

```python
# backend/app/config.py
CORS_ORIGINS: str = "https://your-domain.vercel.app"
```

### 타임아웃 에러

- 백엔드 서버가 실행 중인지 확인
- 네트워크 연결 상태 확인
- 백엔드 로그 확인

## 6. 로컬 개발

### 로컬 환경에서 실행

```bash
# 터미널 1: 백엔드 실행
cd backend
python -m uvicorn app.main:app --reload

# 터미널 2: 프론트엔드 실행
cd frontend
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000 npm run dev
```

### 또는 .env.local 사용

frontend/.env.local:
```
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

```bash
cd frontend
npm run dev
```

## 7. API 엔드포인트

프론트엔드가 호출하는 API:

| 경로 | 설명 |
|------|------|
| `GET /api/health` | 헬스 체크 |
| `GET /api/krx` | KRX 대시보드 전체 |
| `GET /api/krx/investor` | 투자자 매매동향 |
| `GET /api/krx/sector` | 업종별 수익률 |
| `GET /api/krx/short-selling` | 공매도 현황 |
| `GET /api/sectors` | 섹터 성과 |
| `GET /api/sectors/rotation` | 섹터 로테이션 |
| `GET /api/sectors/etfs?sector=반도체` | 섹터별 ETF 랭킹 |

## 8. 배포 최적화

### 캐시 전략

- 프론트엔드: Vercel 기본 캐시 (60초)
- 백엔드 API: 30분 TTL (krx_service, sector_service)

### 콜드 스타트 최적화

- Railway: 항상 실행 중 (Sleep 시간 설정 가능)
- Vercel: 자동 최적화

## 9. 모니터링

### Vercel Analytics

1. Vercel 대시보드 → Analytics
2. 성능, 오류율, 요청 수 모니터링

### 백엔드 로그

Railway 대시보드 → Logs에서 확인

---

**문의**: GitHub Issues를 통해 피드백 제공 부탁합니다.
