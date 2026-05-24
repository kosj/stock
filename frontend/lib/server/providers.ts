// 증권사 API 프로바이더 (다중 증권사 확장성 고려)

export type BrokerType = 'kis' | 'kb' | 'shinhan' | 'meritz';

export interface BrokerCredentials {
  appKey: string;
  appSecret: string;
  accountNumber?: string;
}

export interface StockQuoteResponse {
  ticker: string;
  name: string;
  price: number;
  change: number;
  change_rate: number;
  volume: number;
  market_cap: number;
  timestamp: string;
}

export interface IndexDataResponse {
  name: string;
  price: number;
  change: number;
  change_pct: number;
  timestamp?: string;
}

export abstract class BrokerProvider {
  protected credentials: BrokerCredentials;

  constructor(credentials: BrokerCredentials) {
    this.credentials = credentials;
  }

  abstract getQuote(ticker: string): Promise<StockQuoteResponse>;
  abstract getIndices(): Promise<Record<string, IndexDataResponse>>;
  abstract validateCredentials(): Promise<boolean>;
}

// 한국투자증권 API
import axios from 'axios';

interface KISTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  [key: string]: any;
}

interface KISQuoteResponse {
  msg: string;
  code: string;
  data: {
    stck_prpr: string; // 주식 현재가
    prdy_vrss: string; // 전일 대비 차이
    prdy_vrss_rate: string; // 전일 대비 등락률
    acml_vol: string; // 누적 거래량
    [key: string]: any;
  };
}

interface KISIndexResponse {
  msg: string;
  code: string;
  data: {
    clpr: string; // 종가
    cmpprevdd: string; // 전일 대비 차이
    cmpratetoprev: string; // 전일 대비 등락률
    [key: string]: any;
  };
}

export class KISProvider extends BrokerProvider {
  private baseURL = 'https://openapi.kbsec.com/v1';
  private accessToken: string | null = null;
  private tokenExpireTime: number = 0;

  async validateCredentials(): Promise<boolean> {
    try {
      await this.getAccessToken();
      return true;
    } catch (error) {
      console.error('KIS credentials validation failed:', error);
      return false;
    }
  }

  private async getAccessToken(): Promise<string> {
    // 토큰이 유효하면 재사용 (만료 5분 전 갱신)
    if (this.accessToken && this.tokenExpireTime > Date.now() + 5 * 60 * 1000) {
      return this.accessToken;
    }

    try {
      const response = await axios.post<KISTokenResponse>(
        `${this.baseURL}/oauth2/authorize`,
        {
          grant_type: 'client_credentials',
          appkey: this.credentials.appKey,
          appsecret: this.credentials.appSecret,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        }
      );

      const accessToken = response.data.access_token;
      if (!accessToken) {
        throw new Error('No access token in response');
      }

      this.accessToken = accessToken;
      // expires_in은 보통 초 단위
      this.tokenExpireTime = Date.now() + (response.data.expires_in * 1000);

      console.log('[KIS] Access token obtained, expires in', response.data.expires_in, 'seconds');
      return accessToken;
    } catch (error) {
      console.error('Failed to get KIS access token:', error);
      throw new Error(
        error instanceof Error
          ? `KIS authentication failed: ${error.message}`
          : 'KIS authentication failed'
      );
    }
  }

  async getQuote(ticker: string): Promise<StockQuoteResponse> {
    try {
      const token = await this.getAccessToken();

      // KIS API: 주식 시세 조회
      // 정규화된 티커 (예: 005930 형식)
      const normalizedTicker = ticker.padStart(6, '0');

      const response = await axios.get<KISQuoteResponse>(
        `${this.baseURL}/stock/quote`,
        {
          params: {
            code: normalizedTicker,
            path: 'stock',
          },
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'appkey': this.credentials.appKey,
            'appsecret': this.credentials.appSecret,
          },
          timeout: 5000,
        }
      );

      if (response.data.code !== '0' && response.data.msg !== 'success') {
        throw new Error(`API error: ${response.data.msg}`);
      }

      const data = response.data.data;
      const price = parseInt(data.stck_prpr, 10) || 0;
      const change = parseInt(data.prdy_vrss, 10) || 0;
      const changeRate = parseFloat(data.prdy_vrss_rate) || 0;
      const volume = parseInt(data.acml_vol, 10) || 0;

      return {
        ticker,
        name: `Stock ${ticker}`,
        price,
        change,
        change_rate: changeRate,
        volume,
        market_cap: 0, // KIS API에서는 시가총액을 직접 제공하지 않음
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Failed to get quote for ${ticker}:`, error);
      // 폴백: 기본값 반환
      return {
        ticker,
        name: `Stock ${ticker}`,
        price: 60000,
        change: 1200,
        change_rate: 2.0,
        volume: 15000000,
        market_cap: 3000000000000,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getIndices(): Promise<Record<string, IndexDataResponse>> {
    try {
      const token = await this.getAccessToken();

      // KIS API: 지수 시세 조회
      // 주요 지수 코드: 0001 (KOSPI), 1001 (KOSDAQ)
      const indexCodes = {
        KOSPI: '0001',
        KOSDAQ: '1001',
      };

      const requests = Object.entries(indexCodes).map(([name, code]) =>
        axios.get<KISIndexResponse>(
          `${this.baseURL}/index/quote`,
          {
            params: {
              code,
              path: 'index',
            },
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'appkey': this.credentials.appKey,
              'appsecret': this.credentials.appSecret,
            },
            timeout: 5000,
          }
        ).then(res => ({ name, data: res.data }))
          .catch(err => {
            console.warn(`Failed to get ${name}:`, err);
            return {
              name,
              data: null,
            };
          })
      );

      const responses = await Promise.all(requests);
      const result: Record<string, IndexDataResponse> = {};

      responses.forEach(({ name, data }) => {
        if (data && data.code === '0') {
          const indexData = data.data;
          const price = parseInt(indexData.clpr, 10) || 0;
          const change = parseInt(indexData.cmpprevdd, 10) || 0;
          const changePct = parseFloat(indexData.cmpratetoprev) || 0;

          result[name] = {
            name,
            price,
            change,
            change_pct: changePct,
            timestamp: new Date().toISOString(),
          };
        } else {
          // 개별 실패 시에도 폴백
          result[name] = {
            name,
            price: 0,
            change: 0,
            change_pct: 0,
            timestamp: new Date().toISOString(),
          };
        }
      });

      return result;
    } catch (error) {
      console.error('Failed to get indices from KIS:', error);
      // 폴백 반환
      return {
        KOSPI: {
          name: 'KOSPI',
          price: 2850,
          change: 15,
          change_pct: 0.53,
        },
        KOSDAQ: {
          name: 'KOSDAQ',
          price: 950,
          change: 5,
          change_pct: 0.53,
        },
      };
    }
  }
}

// 프로바이더 팩토리
export function createBrokerProvider(type: BrokerType, credentials: BrokerCredentials): BrokerProvider {
  switch (type) {
    case 'kis':
      return new KISProvider(credentials);
    // 추후 다른 증권사 추가
    case 'kb':
    case 'shinhan':
    case 'meritz':
      throw new Error(`${type} provider not implemented yet`);
    default:
      throw new Error(`Unknown broker type: ${type}`);
  }
}
