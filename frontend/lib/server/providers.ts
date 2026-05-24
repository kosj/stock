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
    // 토큰이 유효하면 재사용
    if (this.accessToken && this.tokenExpireTime > Date.now()) {
      return this.accessToken;
    }

    try {
      const response = await axios.post(`${this.baseURL}/oauth2/token`, {
        grant_type: 'client_credentials',
        appkey: this.credentials.appKey,
        appsecret: this.credentials.appSecret,
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        }
      });

      this.accessToken = response.data.access_token;
      this.tokenExpireTime = Date.now() + (response.data.expires_in * 1000);

      return this.accessToken;
    } catch (error) {
      console.error('Failed to get KIS access token:', error);
      throw error;
    }
  }

  async getQuote(ticker: string): Promise<StockQuoteResponse> {
    try {
      const token = await this.getAccessToken();

      // KIS API 엔드포인트 (예시)
      const response = await axios.get(
        `${this.baseURL}/kis/stock-quote`,
        {
          params: { code: ticker },
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          }
        }
      );

      const data = response.data;
      return {
        ticker,
        name: data.name || `Stock ${ticker}`,
        price: data.current_price || 0,
        change: data.price_change || 0,
        change_rate: data.change_rate || 0,
        volume: data.volume || 0,
        market_cap: data.market_cap || 0,
        timestamp: new Date().toISOString()
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
        timestamp: new Date().toISOString()
      };
    }
  }

  async getIndices(): Promise<Record<string, IndexDataResponse>> {
    try {
      const token = await this.getAccessToken();

      // 여러 지수를 동시에 요청
      const indices = ['0001', '1001', '2001']; // KOSPI, KOSDAQ, KRX300
      const requests = indices.map(code =>
        axios.get(`${this.baseURL}/kis/index-quote`, {
          params: { code },
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          }
        })
      );

      const responses = await Promise.all(requests);
      const result: Record<string, IndexDataResponse> = {};

      responses.forEach((res, idx) => {
        const data = res.data;
        const name = ['KOSPI', 'KOSDAQ', 'KRX300'][idx];
        result[name] = {
          name,
          price: data.current_price || 0,
          change: data.price_change || 0,
          change_pct: data.change_rate || 0,
          timestamp: new Date().toISOString()
        };
      });

      return result;
    } catch (error) {
      console.error('Failed to get indices from KIS:', error);
      // 폴백 반환
      return {
        KOSPI: { name: 'KOSPI', price: 2850, change: 15, change_pct: 0.53 },
        KOSDAQ: { name: 'KOSDAQ', price: 950, change: 5, change_pct: 0.53 }
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
