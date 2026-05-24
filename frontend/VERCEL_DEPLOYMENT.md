# Vercel 배포 가이드 (Vercel Only)

## 개요

이 애플리케이션은 **Vercel에서만 작동**합니다:
- **프론트엔드 + 백엔드 API**: Vercel Serverless Functions
- **데이터 소스**: Naver Finance (크롤링) + Yahoo Finance API
- **배포 환경**: Vercel (무료 호스팅)

Railway, Heroku 등 별도 백엔드 서버는 **불필요**합니다.

## 1. Vercel에 배포하기

### Step 1: GitHub 저장소 준비

```bash
cd d:/godkosj/Project/Stock
git add -A
git commit -m "Update for Vercel-only deployment"
git push origin master
```

### Step 2: Vercel에 프로젝트 연결

1. [Vercel.com](https://vercel.com)에 로그인
2. "New Project" 클릭
3. GitHub 저장소 선택: `kosj/stock`
4. **Import Project** 설정:
   - Framework: `Next.js`
   - Root Directory: `frontend` ✓ (중요!)
   - Build Command: `next build` (자동)
   - Output Directory: `.next` (자동)

5. **Create** 클릭 → 자동 배포 시작

### Step 3: 배포 확인

배포 완료 후 (약 2-3분):

```bash
# 프론트엔드 확인
https://your-domain.vercel.app

# API 헬스 체크
https://your-domain.vercel.app/api/health

# KRX 데이터 (국내증시 통계)
https://your-domain.vercel.app/api/krx

# 섹터 데이터
https://your-domain.vercel.app/api/sectors
```

## 2. 로컬 개발

### 프론트엔드만 실행 (Vercel 내부 API 사용)

```bash
cd frontend
npm install
npm run dev
```

브라우저: http://localhost:3000

### 프론트엔드 + 외부 백엔드 사용 (선택사항)

별도 백엔드 서버(Railway 등)를 실행하려면:

```bash
# .env.local 생성
echo 'NEXT_PUBLIC_BACKEND_URL=https://your-backend.railway.app' > frontend/.env.local

# 개발 서버 실행
cd frontend
npm run dev
```

## 3. API 엔드포인트

Vercel 배포 후 사용 가능한 엔드포인트:

| 경로 | 메서드 | 설명 |
|------|--------|------|
| `/api/health` | GET | 헬스 체크 |
| `/api/krx` | GET | KRX 대시보드 (투자자 매매동향, 공매도, 업종지수) |
| `/api/krx/investor` | GET | 투자자별 매매동향 (KOSPI/KOSDAQ) |
| `/api/krx/sector` | GET | 업종별 수익률 |
| `/api/krx/short-selling` | GET | 공매도 현황 |
| `/api/sectors` | GET | 섹터 성과 분석 |
| `/api/sectors/rotation` | GET | 섹터 로테이션 (테마 분석) |
| `/api/sectors/etfs?sector=반도체&sort_by=1m` | GET | 섹터별 ETF 랭킹 |

## 4. 구현 현황

### ✅ 완료된 기능

- **KRX (국내증시 통계)**
  - 투자자별 매매동향 (Naver Finance 크롤링)
  - 업종별 수익률 (섹터 데이터)
  - 공매도 현황 (Naver Finance)
  - 자금흐름 요약

- **섹터 로테이션**
  - 섹터별 성과 분석
  - 테마 분석 (AI/반도체, 바이오 등)

### ⚠️ 제한사항

- **Vercel 메모리 제한**: 3008 MB
- **실행 시간 제한**: Pro 플랜 60초, 무료 플랜 10초
- **섹터 가격 데이터**: 현재 샘플 데이터 사용
  - 프로덕션: Yahoo Finance API 또는 실시간 API 필요

## 5. 성능 최적화

### 캐시 설정

프론트엔드 (_next/cache):
```
Cache-Control: public, max-age=31536000, immutable (JS/CSS)
Cache-Control: public, max-age=60 (HTML)
```

API 응답 캐싱 (krx_service):
- 30분 TTL (거래소 데이터는 실시간성 낮음)

### 콜드 스타트 최적화

Vercel의 자동 최적화로 인해 별도 설정 불필요

## 6. 트러블슈팅

### API 응답 없음

```
GET /api/krx → 502 Bad Gateway
```

**해결**:
1. Vercel Logs 확인: https://vercel.com/dashboard/[project]/logs
2. 데이터 소스 상태 확인 (Naver Finance 접근 가능 여부)
3. 필요시 재배포: "Redeploy" 클릭

### 타임아웃 에러

```
502 Bad Gateway (timeout)
```

**원인**: API가 60초 내에 응답하지 않음

**해결**:
- Pro 플랜으로 업그레이드 (최대 60초)
- 또는 무료 플랜 사용 (최대 10초, 더 빠른 응답 필요)

### 한국어 인코딩 문제

Naver Finance 크롤링 시 EUC-KR → UTF-8 변환 필요

현재 자동 처리됨 (iconv-lite 사용)

## 7. 비용

### Vercel

- **무료 플랜**
  - 무제한 배포
  - 1000만 요청/월 포함
  - 실행 시간 10초 제한

- **Pro 플랜** ($20/월)
  - 무제한 요청
  - 실행 시간 60초 제한

### 데이터 소스

- **Naver Finance**: 무료 (크롤링)
- **Yahoo Finance API**: 무료 (제한 있음)

## 8. 향후 개선

1. **실시간 가격 데이터**
   - 한국투자증권 API 연동
   - 또는 FinanceDataReader 래퍼 (별도 서버 필요)

2. **포트폴리오 기능**
   - 현재 미구현 (데이터베이스 필요)
   - Vercel KV (Redis) 또는 다른 DB 필요

3. **웹 푸시 알림**
   - 현재 미구현
   - 별도 백엔드 필요

## 문의

- GitHub Issues: [kosj/stock](https://github.com/kosj/stock/issues)
- 배포 문제: Vercel 대시보드 로그 확인
