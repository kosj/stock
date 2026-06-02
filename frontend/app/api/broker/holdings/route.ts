import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFirstBrokerConfig } from "@/lib/server/broker-config";

export const dynamic   = "force-dynamic";
export const maxDuration = 30;

const KIS_BASE = "https://openapi.koreainvestment.com:9443";

export async function POST(request: NextRequest) {
  try {
    // 1. 인증된 사용자 확인
    const serverClient = await createSupabaseServerClient();
    const { data: { user } } = await serverClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증 필요" }, { status: 401 });
    }

    // 2. DB에서 사용자의 증권사 자격증명 조회 (암호화된 상태로 저장됨)
    const config = await getFirstBrokerConfig(user.id);
    if (!config) {
      return NextResponse.json(
        { error: "등록된 증권사 API 키가 없습니다. 설정 → API 설정에서 한국투자증권 키와 계좌번호를 먼저 등록해주세요." },
        { status: 400 },
      );
    }

    // DB에서 불러온 자격증명도 한 번 더 trim (이전에 공백이 섞인 채 저장됐을 경우 대비)
    const appKey        = config.appKey.trim();
    const appSecret     = config.appSecret.trim();
    const accountNumber = config.accountNumber?.replace(/[\s]/g, "");

    if (!accountNumber) {
      return NextResponse.json(
        { error: "계좌번호가 등록되지 않았습니다. 설정 → API 설정에서 계좌번호(앞 8자리 + 뒤 2자리, 예: 12345678-01)를 입력해주세요." },
        { status: 400 },
      );
    }

    // 3. 요청 body에서 isDemo 플래그만 읽음 (자격증명은 DB에서 읽음)
    let isDemo = false;
    try {
      const body = await request.json();
      isDemo = !!body?.isDemo;
    } catch { /* body 없어도 진행 */ }

    // 4. KIS 액세스 토큰 발급
    let tokenRes: Response;
    try {
      tokenRes = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          appkey:     appKey,
          appsecret:  appSecret,
        }),
        signal: AbortSignal.timeout(10_000), // 10초 타임아웃
      });
    } catch (fetchErr) {
      const isTimeout = fetchErr instanceof Error && fetchErr.name === "TimeoutError";
      return NextResponse.json(
        {
          error: isTimeout
            ? "KIS 서버 연결 시간 초과 (10초)"
            : `KIS 서버 연결 실패: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
          hint: "KIS 개발자 포털 → 앱 관리 → IP 설정에서 0.0.0.0(전체 허용)으로 설정되어 있는지 확인하세요.",
        },
        { status: 502 },
      );
    }

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      const kisCode = tokenData.msg_cd ?? tokenData.error ?? "";
      const kisMsg  = tokenData.msg1  ?? tokenData.error_description ?? `HTTP ${tokenRes.status}`;
      const detail  = kisCode ? `[${kisCode}] ${kisMsg}` : kisMsg;
      return NextResponse.json(
        {
          error: `KIS 인증 실패: ${detail}`,
          hint:  tokenRes.status === 401 || tokenRes.status === 403
            ? "KIS 개발자 포털 → 앱 관리 → IP 설정에서 0.0.0.0(전체 허용)으로 설정하거나, 설정 페이지에서 AppKey·AppSecret을 다시 저장해주세요."
            : "설정 페이지에서 AppKey·AppSecret을 다시 저장하거나, KIS 개발자 포털에서 앱 활성화 상태를 확인하세요.",
        },
        { status: 502 },
      );
    }
    if (tokenData.rt_cd && tokenData.rt_cd !== "0") {
      return NextResponse.json(
        { error: `KIS 인증 거부 [rt_cd=${tokenData.rt_cd}]: ${tokenData.msg1 ?? tokenData.rt_cd}` },
        { status: 502 },
      );
    }

    const token = tokenData.access_token as string;

    // 5. 계좌번호 파싱 (하이픈·공백 제거 후 앞 8자리 + 뒤 2자리)
    const cleaned   = accountNumber.replace(/[-\s]/g, "");
    const cano      = cleaned.slice(0, 8);
    const acntPrdtCd = cleaned.slice(8, 10) || "01";

    if (cano.length !== 8) {
      return NextResponse.json(
        { error: `계좌번호 형식 오류: 앞 8자리를 찾을 수 없습니다 (입력값: "${accountNumber}")` },
        { status: 400 },
      );
    }

    // 모의투자: VTTC8434R / 실전투자: TTTC8434R
    const trId = isDemo ? "VTTC8434R" : "TTTC8434R";

    // 6. 잔고 조회
    const params = new URLSearchParams({
      CANO:                 cano,
      ACNT_PRDT_CD:         acntPrdtCd,
      AFHR_FLPR_YN:         "N",
      OFL_YN:               "",
      INQR_DVSN:            "02",
      UNPR_DVSN:            "01",
      FUND_STTL_ICLD_YN:    "N",
      FNCG_AMT_AUTO_RDPT_YN:"N",
      PRCS_DVSN:            "01",
      CTX_AREA_FK100:       "",
      CTX_AREA_NK100:       "",
    });

    const balanceRes = await fetch(
      `${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-balance?${params}`,
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization:  `Bearer ${token}`,
          appkey:         appKey,
          appsecret:      appSecret,
          tr_id:          trId,
          custtype:       "P",
        },
        signal: AbortSignal.timeout(15_000),
      },
    );

    const data = await balanceRes.json();

    if (!balanceRes.ok) {
      const msg = data.msg1 ?? data.message ?? `HTTP ${balanceRes.status}`;
      if (balanceRes.status === 401 || balanceRes.status === 403) {
        return NextResponse.json(
          {
            error: `KIS 인증 오류 (${balanceRes.status}): ${msg}`,
            hint:  "KIS 개발자 포털 → 앱 관리 → IP 설정에서 서버 IP를 추가하거나 0.0.0.0(전체 허용)으로 설정하세요.",
          },
          { status: 502 },
        );
      }
      return NextResponse.json({ error: `KIS 잔고 조회 실패: ${msg}` }, { status: 502 });
    }

    if (data.rt_cd !== "0") {
      const msg  = data.msg1 ?? data.rt_cd;
      const hint =
        data.rt_cd === "7" ? "모의투자/실전투자 계좌 타입이 맞지 않습니다. isDemo 설정을 확인하세요." :
        data.rt_cd === "1" ? "계좌번호 또는 상품코드(뒤 2자리)를 다시 확인하세요." : undefined;
      return NextResponse.json(
        { error: `KIS 잔고 조회 오류 (rt_cd=${data.rt_cd}): ${msg}`, ...(hint ? { hint } : {}) },
        { status: 502 },
      );
    }

    interface KISItem {
      pdno: string; prdt_name: string; hldg_qty: string;
      pchs_avg_pric: string; prpr: string; evlu_pfls_amt: string; evlu_pfls_rt: string;
    }

    const holdings = ((data.output1 ?? []) as KISItem[])
      .filter((h) => parseInt(h.hldg_qty, 10) > 0)
      .map((h) => ({
        ticker:        h.pdno,
        name:          h.prdt_name,
        quantity:      parseInt(h.hldg_qty, 10),
        avg_price:     parseFloat(h.pchs_avg_pric) || 0,
        current_price: parseFloat(h.prpr)          || 0,
        pnl_amount:    parseFloat(h.evlu_pfls_amt) || 0,
        pnl_rate:      parseFloat(h.evlu_pfls_rt)  || 0,
      }));

    return NextResponse.json({ holdings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[broker/holdings] 오류:", msg);
    return NextResponse.json({ error: `서버 오류: ${msg}` }, { status: 500 });
  }
}
