// 증권사 API 프로바이더 (다중 증권사 확장성 고려)

export type BrokerType = 'kis' | 'kb' | 'shinhan' | 'meritz';

export interface BrokerCredentials {
  appKey: string;
  appSecret: string;
  accountNumber?: string;
  isDemo?: boolean; // 모의투자 여부 (기본: 실전)
}

export interface StockQuoteResponse {
  ticker: string;
  name: string;
  price: number;
  change: number;
  change_rate: number;
  volume: number;
  market_cap: number;
  high: number;
  low: number;
  open: number;
  prev_close: number;
  timestamp: string;
}

export interface IndexDataResponse {
  name: string;
  price: number;
  change: number;
  change_pct: number;
  timestamp?: string;
}

export interface BrokerHolding {
  ticker: string;
  name: string;
  quantity: number;
  avg_price: number;
  current_price: number;
  pnl_amount: number;
  pnl_rate: number;
}

export interface StockSearchResult {
  ticker: string;
  name: string;
  market: string;
  sector: string;
}

export abstract class BrokerProvider {
  protected credentials: BrokerCredentials;

  constructor(credentials: BrokerCredentials) {
    this.credentials = credentials;
  }

  abstract getQuote(ticker: string): Promise<StockQuoteResponse>;
  abstract getIndices(): Promise<Record<string, IndexDataResponse>>;
  abstract getPositions(): Promise<BrokerHolding[]>;
  abstract validateCredentials(): Promise<boolean>;
  abstract searchStocks(query: string): Promise<StockSearchResult[]>;
}

// ── 한국투자증권 (KIS) API ────────────────────────────────────────────────────

import axios from 'axios';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

interface KISTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  [key: string]: unknown;
}

interface KISBalanceItem {
  pdno: string;       // 종목코드
  prdt_name: string;  // 종목명
  hldg_qty: string;   // 보유수량
  pchs_avg_pric: string; // 매입평균가격
  prpr: string;       // 현재가
  evlu_pfls_amt: string; // 평가손익금액
  evlu_pfls_rt: string;  // 평가손익률
  [key: string]: string;
}

export class KISProvider extends BrokerProvider {
  private accessToken: string | null = null;
  private tokenExpireTime = 0;

  async validateCredentials(): Promise<boolean> {
    try {
      await this.getAccessToken();
      return true;
    } catch {
      return false;
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpireTime > Date.now() + 5 * 60_000) {
      return this.accessToken;
    }

    const res = await axios.post<KISTokenResponse>(
      `${KIS_BASE}/oauth2/tokenP`,
      {
        grant_type: 'client_credentials',
        appkey: this.credentials.appKey,
        appsecret: this.credentials.appSecret,
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 8000 },
    );

    const token = res.data.access_token;
    if (!token) throw new Error('KIS 인증 실패: access_token 없음');

    this.accessToken = token;
    this.tokenExpireTime = Date.now() + (res.data.expires_in ?? 86400) * 1000;
    return token;
  }

  private parseAccountNumber(raw: string): { cano: string; acntPrdtCd: string } {
    const cleaned = raw.replace(/[-\s]/g, '');
    return {
      cano: cleaned.slice(0, 8),
      acntPrdtCd: cleaned.slice(8, 10) || '01',
    };
  }

  async getPositions(): Promise<BrokerHolding[]> {
    if (!this.credentials.accountNumber) {
      throw new Error('계좌번호가 설정되지 않았습니다. API 설정에서 계좌번호를 입력해주세요.');
    }

    const token = await this.getAccessToken();
    const { cano, acntPrdtCd } = this.parseAccountNumber(this.credentials.accountNumber);
    const trId = this.credentials.isDemo ? 'VTTC8434R' : 'TTTC8434R';

    const res = await axios.get(
      `${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-balance`,
      {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          authorization: `Bearer ${token}`,
          appkey: this.credentials.appKey,
          appsecret: this.credentials.appSecret,
          tr_id: trId,
          custtype: 'P',
        },
        params: {
          CANO: cano,
          ACNT_PRDT_CD: acntPrdtCd,
          AFHR_FLPR_YN: 'N',
          OFL_YN: '',
          INQR_DVSN: '02',
          UNPR_DVSN: '01',
          FUND_STTL_ICLD_YN: 'N',
          FNCG_AMT_AUTO_RDPT_YN: 'N',
          PRCS_DVSN: '01',
          CTX_AREA_FK100: '',
          CTX_AREA_NK100: '',
        },
        timeout: 10_000,
      },
    );

    if (res.data.rt_cd !== '0') {
      throw new Error(`KIS API 오류: ${res.data.msg1 ?? res.data.rt_cd}`);
    }

    const items: KISBalanceItem[] = res.data.output1 ?? [];
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

  async getQuote(ticker: string): Promise<StockQuoteResponse> {
    try {
      const token = await this.getAccessToken();
      const res = await axios.get(
        `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`,
        {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            authorization: `Bearer ${token}`,
            appkey: this.credentials.appKey,
            appsecret: this.credentials.appSecret,
            tr_id: 'FHKST01010100',
          },
          params: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: ticker.padStart(6, '0') },
          timeout: 5000,
        },
      );

      const d = res.data.output ?? {};
      const price = parseInt(d.stck_prpr, 10) || 0;
      const change = parseInt(d.prdy_vrss, 10) || 0;
      return {
        ticker,
        name:       d.hts_kor_isnm ?? `Stock ${ticker}`,
        price,
        change,
        change_rate: parseFloat(d.prdy_ctrt) || 0,
        volume:      parseInt(d.acml_vol, 10) || 0,
        market_cap:  0,
        high:        parseInt(d.stck_hgpr, 10) || price,
        low:         parseInt(d.stck_lwpr, 10) || price,
        open:        parseInt(d.stck_oprc, 10) || price,
        prev_close:  parseInt(d.stck_sdpr, 10) || (price - change),
        timestamp:   new Date().toISOString(),
      };
    } catch (err) {
      console.error(`[KIS] getQuote ${ticker}:`, err);
      throw err;
    }
  }

  async getIndices(): Promise<Record<string, IndexDataResponse>> {
    try {
      const token = await this.getAccessToken();
      const codes: Record<string, string> = { KOSPI: '0001', KOSDAQ: '1001' };
      const results = await Promise.allSettled(
        Object.entries(codes).map(async ([name, code]) => {
          const res = await axios.get(
            `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-index-price`,
            {
              headers: {
                'content-type': 'application/json; charset=utf-8',
                authorization: `Bearer ${token}`,
                appkey: this.credentials.appKey,
                appsecret: this.credentials.appSecret,
                tr_id: 'FHPUP02100000',
              },
              params: { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: code },
              timeout: 5000,
            },
          );
          const d = res.data.output ?? {};
          return { name, price: parseFloat(d.bstp_nmix_prpr) || 0, change: parseFloat(d.bstp_nmix_prdy_vrss) || 0, change_pct: parseFloat(d.bstp_nmix_prdy_ctrt) || 0 };
        }),
      );

      const out: Record<string, IndexDataResponse> = {};
      results.forEach((r, i) => {
        const name = Object.keys(codes)[i];
        if (r.status === 'fulfilled') {
          out[name] = { ...r.value, timestamp: new Date().toISOString() };
        } else {
          out[name] = { name, price: 0, change: 0, change_pct: 0 };
        }
      });
      return out;
    } catch (err) {
      console.error('[KIS] getIndices:', err);
      return {
        KOSPI: { name: 'KOSPI', price: 0, change: 0, change_pct: 0 },
        KOSDAQ: { name: 'KOSDAQ', price: 0, change: 0, change_pct: 0 },
      };
    }
  }

  async searchStocks(query: string): Promise<StockSearchResult[]> {
    // 6자리 코드 → 직접 시세 조회로 결과 반환
    if (/^\d{6}$/.test(query)) {
      try {
        const q = await this.getQuote(query);
        return [{ ticker: query, name: q.name, market: 'KSE', sector: '' }];
      } catch {
        return [];
      }
    }

    // 종목명 검색 (KIS search-stock-info)
    try {
      const token = await this.getAccessToken();
      const res = await axios.get(
        `${KIS_BASE}/uapi/domestic-stock/v1/quotations/search-stock-info`,
        {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            authorization: `Bearer ${token}`,
            appkey: this.credentials.appKey,
            appsecret: this.credentials.appSecret,
            tr_id: 'CTPF1604R',
            custtype: 'P',
          },
          params: { PRDT_TYPE_CD: '300', PDNO: query },
          timeout: 5000,
        },
      );

      if (res.data.rt_cd !== '0') return [];

      const raw = res.data.output;
      const output: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

      return output
        .slice(0, 10)
        .map((item: any) => ({
          ticker: (item.pdno ?? '').trim(),
          name:   item.prdt_abrv_name || item.prdt_name || item.pdno || '',
          market: 'KSE',
          sector: item.bstp_kor_isnm ?? '',
        }))
        .filter((r) => r.ticker);
    } catch (err) {
      console.error('[KIS] searchStocks error:', err);
      return [];
    }
  }
}

// ── 프로바이더 팩토리 ────────────────────────────────────────────────────────

export function createBrokerProvider(type: BrokerType, credentials: BrokerCredentials): BrokerProvider {
  switch (type) {
    case 'kis':
      return new KISProvider(credentials);
    default:
      throw new Error(`${type} 증권사는 아직 지원되지 않습니다`);
  }
}
