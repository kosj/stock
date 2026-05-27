/**
 * KIS Open API — 브라우저 직접 호출 모듈
 * Vercel 서버리스 경유 없이 브라우저에서 직접 KIS API를 호출한다.
 * 토큰은 sessionStorage에 캐시하여 탭 세션 내에서 재사용한다.
 *
 * 사전 조건: KIS 개발자 포털에서 현재 PC의 공인 IP를 화이트리스트에 등록해야 한다.
 */

import type { BrokerCredentials, BrokerHolding } from "@/lib/server/providers";

const KIS_BASE = "https://openapi.koreainvestment.com:9443";
const TOKEN_KEY = "kis-token-cache";

interface TokenCache {
  token: string;
  expiresAt: number;
  appKeyPrefix: string; // appKey 앞 8자 — 자격증명 변경 시 캐시 무효화
}

interface KISTokenResponse {
  access_token?: string;
  expires_in?: number;
  rt_cd?: string;
  msg1?: string;
  [key: string]: unknown;
}

interface KISBalanceItem {
  pdno: string;
  prdt_name: string;
  hldg_qty: string;
  pchs_avg_pric: string;
  prpr: string;
  evlu_pfls_amt: string;
  evlu_pfls_rt: string;
  [key: string]: string;
}

function parseAccountNumber(raw: string): { cano: string; acntPrdtCd: string } {
  const cleaned = raw.replace(/[-\s]/g, "");
  return {
    cano: cleaned.slice(0, 8),
    acntPrdtCd: cleaned.slice(8, 10) || "01",
  };
}

async function getKisToken(appKey: string, appSecret: string): Promise<string> {
  const appKeyPrefix = appKey.slice(0, 8);

  // sessionStorage 캐시 확인
  try {
    const cached = sessionStorage.getItem(TOKEN_KEY);
    if (cached) {
      const parsed: TokenCache = JSON.parse(cached);
      if (
        parsed.appKeyPrefix === appKeyPrefix &&
        parsed.expiresAt > Date.now() + 5 * 60_000
      ) {
        return parsed.token;
      }
    }
  } catch {
    // sessionStorage 접근 실패 시 무시하고 새 토큰 발급
  }

  const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: appKey,
      appsecret: appSecret,
    }),
  });

  let data: KISTokenResponse;
  try {
    data = await res.json();
  } catch {
    throw new Error(`KIS 인증 실패 (HTTP ${res.status}): 응답 파싱 오류`);
  }

  if (!res.ok) {
    const msg = data.msg1 ?? data.message ?? String(res.status);
    throw new Error(`KIS 인증 실패 (HTTP ${res.status}): ${msg}`);
  }

  if (data.rt_cd && data.rt_cd !== "0") {
    throw new Error(`KIS 인증 거부: ${data.msg1 ?? data.rt_cd}`);
  }

  const token = data.access_token;
  if (!token) {
    throw new Error("KIS 인증 실패: access_token 없음 — AppKey/AppSecret 확인 필요");
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 86400;
  const cache: TokenCache = {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
    appKeyPrefix,
  };

  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(cache));
  } catch {
    // sessionStorage 저장 실패 시 무시 (캐시 없이 계속)
  }

  return token;
}

export async function getKisPositions(creds: BrokerCredentials): Promise<BrokerHolding[]> {
  if (!creds.accountNumber) {
    throw new Error("계좌번호가 설정되지 않았습니다. API 설정에서 계좌번호를 입력해주세요.");
  }

  const token = await getKisToken(creds.appKey, creds.appSecret);
  const { cano, acntPrdtCd } = parseAccountNumber(creds.accountNumber);
  const trId = creds.isDemo ? "VTTC8434R" : "TTTC8434R";

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

  const res = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-balance?${params}`,
    {
      method: "GET",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${token}`,
        appkey: creds.appKey,
        appsecret: creds.appSecret,
        tr_id: trId,
        custtype: "P",
      },
    },
  );

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error(`KIS 잔고조회 실패 (HTTP ${res.status}): 응답 파싱 오류`);
  }

  if (!res.ok) {
    const msg = (data.msg1 ?? data.message ?? String(res.status)) as string;
    if (res.status === 401 || res.status === 403) {
      throw new Error(`KIS 인증 오류 (${res.status}): IP 화이트리스트 또는 AppKey 확인 필요 — ${msg}`);
    }
    throw new Error(`KIS 잔고조회 실패 (HTTP ${res.status}): ${msg}`);
  }

  if (data.rt_cd !== "0") {
    const msg = (data.msg1 ?? data.msg_cd ?? data.rt_cd) as string;
    throw new Error(`KIS 잔고조회 오류: ${msg}`);
  }

  const items: KISBalanceItem[] = (data.output1 as KISBalanceItem[]) ?? [];
  return items
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
}
