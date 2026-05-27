// Supabase Edge Function — KIS 보유종목 조회 프록시
// Deno 런타임에서 서버사이드 KIS API 호출 (CORS 없음)
// 배포: supabase functions deploy kis-holdings --no-verify-jwt

const KIS_BASE = "https://openapi.koreainvestment.com:9443";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { appKey, appSecret, accountNumber, isDemo } = await req.json();

    if (!appKey || !appSecret || !accountNumber) {
      return new Response(
        JSON.stringify({ error: "appKey, appSecret, accountNumber 필요" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    // 1. 토큰 발급
    const tokenRes = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: appKey,
        appsecret: appSecret,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      const msg = tokenData.msg1 ?? tokenData.error_description ?? `HTTP ${tokenRes.status}`;
      return new Response(
        JSON.stringify({ error: `KIS 인증 실패: ${msg}` }),
        { status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    if (tokenData.rt_cd && tokenData.rt_cd !== "0") {
      return new Response(
        JSON.stringify({ error: `KIS 인증 거부: ${tokenData.msg1 ?? tokenData.rt_cd}` }),
        { status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const token = tokenData.access_token as string;

    // 2. 계좌번호 파싱
    const cleaned = accountNumber.replace(/[-\s]/g, "");
    const cano = cleaned.slice(0, 8);
    const acntPrdtCd = cleaned.slice(8, 10) || "01";
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
        return new Response(
          JSON.stringify({ error: `KIS 인증 오류 (${balanceRes.status}): IP 화이트리스트 또는 AppKey 확인 필요 — ${msg}` }),
          { status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
        );
      }
      return new Response(
        JSON.stringify({ error: `KIS 잔고조회 실패: ${msg}` }),
        { status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    if (data.rt_cd !== "0") {
      return new Response(
        JSON.stringify({ error: `KIS 잔고조회 오류: ${data.msg1 ?? data.rt_cd}` }),
        { status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
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
        ticker: h.pdno,
        name: h.prdt_name,
        quantity: parseInt(h.hldg_qty, 10),
        avg_price: parseFloat(h.pchs_avg_pric) || 0,
        current_price: parseFloat(h.prpr) || 0,
        pnl_amount: parseFloat(h.evlu_pfls_amt) || 0,
        pnl_rate: parseFloat(h.evlu_pfls_rt) || 0,
      }));

    return new Response(
      JSON.stringify({ holdings }),
      { headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `서버 오류: ${msg}` }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }
});
