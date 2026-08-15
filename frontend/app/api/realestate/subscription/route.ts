/**
 * GET /api/realestate/subscription?page=1&perPage=20
 *
 * 신규 아파트 분양(청약) 공고 조회 — 공공데이터포털(data.go.kr)의
 * 한국부동산원 「청약홈 분양정보 조회 서비스」를 사용한다.
 *
 * 키가 없으면 표본 데이터를 만들어 보여주지 않고 503 + 설정 안내를 반환한다.
 * (분양 일정·주소를 가짜로 표시하면 사용자가 실제 청약 일정을 놓칠 수 있다)
 *
 * 환경변수: DATA_GO_KR_SERVICE_KEY  (공공데이터포털 → 마이페이지 → 인증키)
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const BASE = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail";

interface ApplyHomeItem {
  HOUSE_MANAGE_NO?: string;
  PBLANC_NO?: string;
  HOUSE_NM?: string;          // 주택명
  HSSPLY_ADRES?: string;      // 공급위치
  TOT_SUPLY_HSHLDCO?: number; // 총 공급세대수
  RCRIT_PBLANC_DE?: string;   // 모집공고일
  RCEPT_BGNDE?: string;       // 청약접수 시작일(1순위)
  RCEPT_ENDDE?: string;       // 청약접수 종료일
  SPSPLY_RCEPT_BGNDE?: string;// 특별공급 접수 시작일
  PRZWNER_PRESNATN_DE?: string; // 당첨자 발표일
  CNTRCT_CNCLS_BGNDE?: string;  // 계약 시작일
  CNTRCT_CNCLS_ENDDE?: string;  // 계약 종료일
  SUBSCRPT_AREA_CODE_NM?: string; // 공급지역명
  RENT_SECD_NM?: string;      // 분양/임대 구분
  HOUSE_SECD_NM?: string;     // 주택구분
  PBLANC_URL?: string;        // 공고 상세 URL
  [k: string]: unknown;
}

/** YYYY-MM-DD 문자열 → 오늘 기준 D-day (음수 = 지남) */
function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export async function GET(req: NextRequest) {
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!key) {
    // 표본 공고를 만들어 보여주면 실제 일정으로 오인될 수 있으므로 명시적 실패.
    return NextResponse.json(
      {
        error: "청약 데이터 API 키가 설정되지 않았습니다.",
        setup: {
          // 인증키는 청약홈(applyhome.co.kr)이 아니라 공공데이터포털에서 발급된다.
          // 주의: 15101046 은 같은 이름의 "파일데이터"(CSV)라 활용신청 버튼이 없다.
          //       활용신청이 가능한 것은 오픈API 데이터셋 15098547 이다.
          steps: [
            "공공데이터포털(data.go.kr) 회원가입 후 로그인 — 청약홈 사이트가 아닙니다",
            "아래 링크(오픈API 15098547)로 이동 — 이름이 같은 '파일데이터' 페이지에는 활용신청 버튼이 없습니다",
            "페이지 우측 상단 [활용신청] → 이용허락범위 동의 → 신청 (자동 승인)",
            "마이페이지 → 데이터활용 → Open API → 인증키 발급현황",
            "일반 인증키(Decoding) 값을 복사 — Encoding 값이 아닙니다",
            "Vercel → 프로젝트 → Settings → Environment Variables 에 DATA_GO_KR_SERVICE_KEY 로 저장 후 재배포",
          ],
          docUrl: "https://www.data.go.kr/data/15098547/openapi.do",
        },
      },
      { status: 503 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const perPage = Math.min(50, Math.max(1, parseInt(sp.get("perPage") ?? "20", 10) || 20));

  const url = `${BASE}?page=${page}&perPage=${perPage}&serviceKey=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `청약 API 오류 (HTTP ${res.status})` },
        { status: 502 },
      );
    }
    const json = await res.json();
    const items: ApplyHomeItem[] = json?.data ?? [];

    const notices = items.map((it) => ({
      id:        it.PBLANC_NO ?? it.HOUSE_MANAGE_NO ?? "",
      name:      it.HOUSE_NM ?? "-",
      address:   it.HSSPLY_ADRES ?? "",
      region:    it.SUBSCRPT_AREA_CODE_NM ?? "",
      houseType: it.HOUSE_SECD_NM ?? "",
      saleType:  it.RENT_SECD_NM ?? "",
      totalUnits: it.TOT_SUPLY_HSHLDCO ?? null,
      noticeDate: it.RCRIT_PBLANC_DE ?? null,
      specialStart: it.SPSPLY_RCEPT_BGNDE ?? null,
      applyStart: it.RCEPT_BGNDE ?? null,
      applyEnd:   it.RCEPT_ENDDE ?? null,
      winnerDate: it.PRZWNER_PRESNATN_DE ?? null,
      contractStart: it.CNTRCT_CNCLS_BGNDE ?? null,
      contractEnd:   it.CNTRCT_CNCLS_ENDDE ?? null,
      url:        it.PBLANC_URL ?? null,
      dDayApply:  daysUntil(it.RCEPT_BGNDE),
    }));

    // 접수 임박(D-day 오름차순) 우선 정렬 — 지난 공고는 뒤로
    notices.sort((a, b) => {
      const ax = a.dDayApply ?? 9999, bx = b.dDayApply ?? 9999;
      const aPast = ax < 0, bPast = bx < 0;
      if (aPast !== bPast) return aPast ? 1 : -1;
      return aPast ? bx - ax : ax - bx;
    });

    return NextResponse.json(
      { count: notices.length, updated_at: new Date().toISOString(), notices },
      { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=600" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "조회 실패";
    return NextResponse.json({ error: `청약 정보를 불러오지 못했습니다: ${message}` }, { status: 503 });
  }
}
