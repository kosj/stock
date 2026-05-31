import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// KIS API를 Next.js API Route에서 직접 호출 (Supabase Edge Function 경유 제거)
// Vercel 서버에서 호출하므로 CORS 없음
const KIS_BASE = "https://openapi.koreainvestment.com:9443";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { appKey, appSecret, accountNumber, isDemo } = body;

    if (!appKey || !appSecret) {
      return NextResponse.json({ error: "appKey와 appSecret이 필요합니다" }, { status: 400 });
    }
    if (!accountNumber) {
      return NextResponse.json(
        { error: "계좌번호가 필요합니다. 설정 → API 설정에서 계좌번호(앞 8자리 + 뒤 2자리, 예: 12345678-01)를 입력해주세요." },
        { status: 400 },
      );
    }

    // 1. KIS 액세스 토큰 발급
    let tokenData: any;
    try {
      const tokenRes = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          appkey: appKey,
          appsecret: appSecret,
        }),
      });
      tokenData = await tokenRes.json();

      if (!tokenRes.ok || !tokenData.access_token) {
        const msg = tokenData.msg1 ?? tokenData.error_description ?? `HTTP ${tokenRes.status}`;
        return NextResponse.json(
          {
            error: `KIS 인증 실패: ${msg}`,
            hint: "AppKey·AppSecret을 다시 확인하고, KIS 개발자 포털(https://apiportal.koreainvestment.com)에서 앱이 활성화 상태인지 확인하세요.",
          },
          { status: 502 },
        );
      }

      if (tokenData.rt_cd && tokenData.rt_cd !== "0") {
        return NextResponse.json(
          { error: `KIS 인증 거부: ${tokenData.msg1 ?? tokenData.rt_cd}` },
          { status: 502 },
        );
      }
    } catch (fetchErr) {
      return NextResponse.json(
        {
          error: "KIS 서버 연결 실패",
          hint: "KIS API 서버(openapi.koreainvestment.com)에 접근할 수 없습니다. 네트워크 또는 방화벽 문제일 수 있습니다.",
        },
        { status: 502 },
      );
    }

    const token = tokenData.access_token as string;

    // 2. 계좌번호 파싱 (하이픈·공백 제거 후 앞 8자리 + 뒤 2자리)
    const cleaned = accountNumber.replace(/[-\s]/g, "");
    const cano = cleaned.slice(0, 8);
    const acntPrdtCd = cleaned.slice(8, 10) || "01";

    if (cano.length !== 8) {
      return NextResponse.json(
        { error: `계좌번호 형식 오류: 앞 8자리를 찾을 수 없습니다 (입력값: "${accountNumber}")` },
        { status: 400 },
      );
    }

    // 모의투자: VTTC8434R / 실전투자: TTTC8434R
    const trId = isDemo ? "VTTC8434R" : "TTTC8434R";

    // 3. 잔고 조회
    const params = new URLSearchParams({
      CANO: cano,
      ACNT_PRDT_CD: acntPrdtCd,
      AFHR_FLPR_YN: "N",
      OFL_YN: "",
      INQR_DVSN: "02",
      UNPR_DVSN: "01",
      FUND_STTL_ICLD_YN: "N",
      FNCG_AMT_AUTO_RDPT_YN: "N",
      PRCS_DVSN: "01",
      CTX_AREA_FK100: "",
      CTX_AREA_NK100: "",
    });

    const balanceRes = await fetch(
      `${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-balance?${params}`,
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${token}`,
          appkey: appKey,
          appsecret: appSecret,
          tr_id: trId,
          custtype: "P",
        },
      },
    );

    const data = await balanceRes.json();

    if (!balanceRes.ok) {
      const msg = data.msg1 ?? data.message ?? `HTTP ${balanceRes.status}`;
      if (balanceRes.status === 401 || balanceRes.status === 403) {
        return NextResponse.json(
          {
            error: `KIS 인증 오류 (${balanceRes.status}): ${msg}`,
            hint: "KIS 개발자 포털 → 앱 관리 → IP 설정에서 현재 서버 IP를 추가하거나, IP를 0.0.0.0(전체 허용)으로 설정하세요.",
          },
          { status: 502 },
        );
      }
      return NextResponse.json(
        { error: `KIS 잔고 조회 실패: ${msg}` },
        { status: 502 },
      );
    }

    if (data.rt_cd !== "0") {
      const msg = data.msg1 ?? data.rt_cd;
      const hint =
        data.rt_cd === "7"
          ? "모의투자 계좌번호로 실전 tr_id를 사용하거나, 그 반대입니다. isDemo 설정을 확인하세요."
          : data.rt_cd === "1"
          ? "계좌번호 또는 상품코드(뒤 2자리)를 다시 확인하세요."
          : undefined;
      return NextResponse.json(
        { error: `KIS 잔고 조회 오류 (rt_cd=${data.rt_cd}): ${msg}`, ...(hint ? { hint } : {}) },
        { status: 502 },
      );
    }

    interface KISItem {
      pdno: string;
      prdt_name: string;
      hldg_qty: string;
      pchs_avg_pric: string;
      prpr: string;
      evlu_pfls_amt: string;
      evlu_pfls_rt: string;
    }

    const holdings = ((data.output1 ?? []) as KISItem[])
      .filter((h) => parseInt(h.hldg_qty, 10) > 0)
      .map((h) => ({
        ticker:        h.pdno,
        name:          h.prdt_name,
        quantity:      parseInt(h.hldg_qty, 10),
        avg_price:     parseFloat(h.pchs_avg_pric) || 0,
        current_price: parseFloat(h.prpr) || 0,
        pnl_amount:    parseFloat(h.evlu_pfls_amt) || 0,
        pnl_rate:      parseFloat(h.evlu_pfls_rt) || 0,
      }));

    return NextResponse.json({ holdings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[broker/holdings] 오류:", msg);
    return NextResponse.json({ error: `서버 오류: ${msg}` }, { status: 500 });
  }
}
