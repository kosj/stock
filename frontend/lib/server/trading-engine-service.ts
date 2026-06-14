/**
 * TradingEngineService — Top 20 기반 자동매매 엔진 (포트 주입형)
 *
 * 전략: Sell First → Buy Next
 *   매도 조건 (3가지 중 하나라도 해당):
 *     1. 손절(Stop-loss):  수익률 ≤ -5%
 *     2. 익절(Take-profit): 수익률 ≥ +10%
 *     3. 랭크아웃:          오늘의 Top 20 리스트에 미포함
 *   매수 조건:
 *     - Top 20 리스트에서 rank 순으로, 미보유 종목만 빈 슬롯(최대 5개)까지 균등 비중 매수
 *
 * 아키텍처: 헥사고날. 엔진은 포트(BrokerPort/MarketDataPort/RecommendationPort/ClockPort)에만
 * 의존하며, 구현체는 생성자로 주입된다. 브로커는 계정별(모의/실전)로 주입되어
 * 동일 엔진이 올바른 시장에 주문한다. 모든 주문은 clientOrderId로 멱등 처리된다.
 */

import { MockBrokerAdapter } from "./adapters/mock-broker-adapter";
import { YahooMarketDataAdapter } from "./adapters/yahoo-market-data-adapter";
import { SupabaseRecommendationAdapter } from "./adapters/supabase-recommendation-adapter";
import { KrMarketClock } from "./adapters/kr-market-clock";
import { supabase } from "./supabase";

import type { BrokerPort } from "@/lib/core/ports/broker-port";
import type { MarketDataPort } from "@/lib/core/ports/market-data-port";
import type { RecommendationPort } from "@/lib/core/ports/recommendation-port";
import type { ClockPort } from "@/lib/core/ports/clock-port";
import type { BrokerPosition } from "@/lib/core/domain/account";
import type { Recommendation } from "@/lib/core/domain/recommendation";
import type { OrderResult, OrderSide } from "@/lib/core/domain/order";

// ── 상수 ─────────────────────────────────────────────────────────────────────

/** 최대 동시 보유 종목 수 */
const MAX_HOLDINGS = 5;
/** 손절 기준 수익률 (%) */
const STOP_LOSS_PCT = -5;
/** 익절 기준 수익률 (%) */
const TAKE_PROFIT_PCT = 10;

// ── 출력 타입 (UI 계약 — 변경 금지) ──────────────────────────────────────────

/**
 * 자동매매 실행 로그 한 줄 (UI의 AutoTradeDetail 타입과 호환)
 * action이 BUY/SELL 이면 실제 체결, SKIP 이면 조건 미충족 또는 실패
 */
export interface TradeDetail {
  ticker:  string;
  name:    string;
  action:  "BUY" | "SELL" | "SKIP";
  reason:  string;
  qty?:    number;
  price?:  number;
  /** 체결 금액 (원) */
  amount?: number;
  /** 주문 실패 시 에러 메시지 */
  error?:  string;
}

/** executeTrading() 반환 타입 */
export interface TradingResult {
  tickers_analyzed: number;
  trades_buy:       number;
  trades_sell:      number;
  skipped:          number;
  details:          TradeDetail[];
  error?:           string;
}

/** 엔진 의존성 (브로커 외 — 미지정 시 기본 어댑터 사용) */
export interface TradingEngineDeps {
  marketData?:      MarketDataPort;
  recommendations?: RecommendationPort;
  clock?:           ClockPort;
}

// ── TradingEngineService ──────────────────────────────────────────────────────

export class TradingEngineService {
  private readonly broker:          BrokerPort;
  private readonly marketData:      MarketDataPort;
  private readonly recommendations: RecommendationPort;
  private readonly clock:           ClockPort;

  /**
   * @param broker 계정별 브로커 구현체 (모의/실전). 미지정 시 userId 바인딩이 필요하므로
   *               호출 측은 broker-factory.getBrokerForUser(userId)로 주입해야 한다.
   * @param deps   시세/추천/시계 포트. 계정 비종속(전역)이라 기본 어댑터를 사용한다.
   */
  constructor(broker: BrokerPort, deps: TradingEngineDeps = {}) {
    this.broker          = broker;
    this.marketData      = deps.marketData      ?? new YahooMarketDataAdapter();
    this.recommendations = deps.recommendations ?? new SupabaseRecommendationAdapter();
    this.clock           = deps.clock           ?? new KrMarketClock();
  }

  /**
   * 모의 브로커로 동작하는 엔진을 즉시 생성하는 편의 팩토리.
   * (실전은 broker-factory.getBrokerForUser → new TradingEngineService(broker) 경로 사용)
   */
  static mockForUser(userId: string, deps: TradingEngineDeps = {}): TradingEngineService {
    return new TradingEngineService(new MockBrokerAdapter(userId, deps.marketData), deps);
  }

  // ── 퍼블릭 진입점 ─────────────────────────────────────────────────────────

  async executeTrading(userId: string): Promise<TradingResult> {
    const details: TradeDetail[] = [];
    let trades_buy  = 0;
    let trades_sell = 0;
    let skipped     = 0;

    try {
      console.log(`[TradingEngine] 시작 — userId=${userId}`);

      // 멱등성 키 일자 기준 (KST 거래일)
      const runDate = this.clock.tradingDateKst();

      // ── Step 1: 사전 데이터 병렬 수집 ────────────────────────────────────
      const [top20, account, holdings] = await Promise.all([
        this.recommendations.getTopRecommendations(20),
        this.broker.getBalance(),
        this.broker.getPositions(),
      ]);

      if (!top20.length) {
        console.warn("[TradingEngine] Top20 추천 데이터 없음 — 종료");
        return { tickers_analyzed: 0, trades_buy: 0, trades_sell: 0, skipped: 0, details: [] };
      }

      const top20Set = new Set(top20.map((r) => r.ticker));

      // 가용 예수금: auto_trade_capital 설정 시 min(현금, 설정자본), 아니면 전체 현금
      let availableCash =
        account.autoTradeCapital !== null
          ? Math.min(account.cash, account.autoTradeCapital)
          : account.cash;

      console.log(
        `[TradingEngine] Top20=${top20.length}종목, 보유=${holdings.length}종목, ` +
        `가용예수금=${availableCash.toLocaleString()}원`,
      );

      // ── Step 2: 매도 먼저 (Sell First) ───────────────────────────────────
      const sellResult = await this.executeSells(userId, runDate, holdings, top20Set, details);
      trades_sell   = sellResult.sellCount;
      skipped      += sellResult.skipCount;
      availableCash += sellResult.cashRecovered;

      console.log(
        `[TradingEngine] 매도 완료 — ${trades_sell}건, 회수=${sellResult.cashRecovered.toLocaleString()}원, ` +
        `가용예수금=${availableCash.toLocaleString()}원`,
      );

      // ── Step 3: 매수 (Buy Next) — 매도 후 최신 보유 재조회 ───────────────
      const holdingsAfterSell = await this.broker.getPositions();
      const buyResult = await this.executeBuys(userId, runDate, top20, holdingsAfterSell, availableCash, details);
      trades_buy = buyResult.buyCount;
      skipped   += buyResult.skipCount;

      console.log(`[TradingEngine] 매수 완료 — ${trades_buy}건`);

      // ── Step 4: 로그 기록 ─────────────────────────────────────────────────
      const tickers_analyzed = new Set([
        ...holdings.map((h) => h.ticker),
        ...top20.map((r) => r.ticker),
      ]).size;

      await supabase.from("mock_auto_trade_logs").insert({
        user_id:          userId,
        tickers_analyzed,
        trades_buy,
        trades_sell,
        skipped,
        details:          JSON.stringify(details.slice(0, 50)),
      });

      return { tickers_analyzed, trades_buy, trades_sell, skipped, details };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[TradingEngine] 치명적 오류: ${msg}`);
      try {
        await supabase.from("mock_auto_trade_logs").insert({
          user_id: userId, tickers_analyzed: 0, trades_buy: 0, trades_sell: 0, skipped: 0,
          details: "[]", error: msg,
        });
      } catch { /* 로그 실패는 무시 */ }
      return { tickers_analyzed: 0, trades_buy: 0, trades_sell: 0, skipped: 0, details: [], error: msg };
    }
  }

  // ── 멱등성 키 ─────────────────────────────────────────────────────────────
  // 일 1회 전략 기준 (티커당 매수/매도 각 1회) → 같은 날 재시도 시 중복 체결 차단
  private clientOrderId(userId: string, runDate: string, side: OrderSide, ticker: string): string {
    return `${userId}:${runDate}:${side}:${ticker}`;
  }

  // ── 프라이빗: 매도 로직 ───────────────────────────────────────────────────

  private async executeSells(
    userId:   string,
    runDate:  string,
    holdings: BrokerPosition[],
    top20Set: Set<string>,
    details:  TradeDetail[],
  ): Promise<{ sellCount: number; skipCount: number; cashRecovered: number }> {
    let sellCount     = 0;
    let skipCount     = 0;
    let cashRecovered = 0;

    for (const h of holdings) {
      const isStopLoss   = h.pnlPct <= STOP_LOSS_PCT;
      const isTakeProfit = h.pnlPct >= TAKE_PROFIT_PCT;
      const isRankOut    = !top20Set.has(h.ticker);

      if (!isStopLoss && !isTakeProfit && !isRankOut) {
        skipCount++;
        details.push({
          ticker: h.ticker, name: h.name, action: "SKIP",
          reason: `보유 유지 (수익률 ${h.pnlPct >= 0 ? "+" : ""}${h.pnlPct.toFixed(2)}%, Top20 포함)`,
        });
        continue;
      }

      const reasons: string[] = [];
      if (isStopLoss)   reasons.push(`손절 ${h.pnlPct.toFixed(2)}% (기준: ${STOP_LOSS_PCT}%)`);
      if (isTakeProfit) reasons.push(`익절 +${h.pnlPct.toFixed(2)}% (기준: +${TAKE_PROFIT_PCT}%)`);
      if (isRankOut)    reasons.push("랭크아웃 — Top20 미포함");
      const reason = reasons.join(" + ");

      try {
        const result = await this.broker.placeOrder({
          clientOrderId:  this.clientOrderId(userId, runDate, "SELL", h.ticker),
          ticker:         h.ticker,
          name:           h.name,
          side:           "SELL",
          quantity:       h.quantity,
          type:           "MARKET",
          referencePrice: h.currentPrice,
        });

        if (result.status === "FILLED") {
          sellCount++;
          // 멱등 중복이면 현금은 이미 이전 실행에 반영됨 → 예산 이중 계상 방지
          if (!result.duplicate) cashRecovered += result.filledAmount;
          details.push({
            ticker: h.ticker, name: h.name, action: "SELL",
            reason: result.duplicate ? `${reason} (이미 체결됨)` : reason,
            qty: h.quantity, price: h.currentPrice, amount: result.filledAmount,
          });
          console.log(`[TradingEngine] 매도 ${result.duplicate ? "(중복무시)" : "체결"}: ${h.ticker} ${h.quantity}주 — ${reason}`);
        } else {
          skipCount++;
          details.push({ ticker: h.ticker, name: h.name, action: "SKIP", reason: `매도 실패: ${result.error}`, error: result.error });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipCount++;
        details.push({ ticker: h.ticker, name: h.name, action: "SKIP", reason: `매도 예외: ${msg}`, error: msg });
        console.error(`[TradingEngine] 매도 예외 [${h.ticker}]: ${msg}`);
      }
    }

    return { sellCount, skipCount, cashRecovered };
  }

  // ── 프라이빗: 매수 로직 ───────────────────────────────────────────────────

  private async executeBuys(
    userId:            string,
    runDate:           string,
    top20:             Recommendation[],
    holdingsAfterSell: BrokerPosition[],
    availableCash:     number,
    details:           TradeDetail[],
  ): Promise<{ buyCount: number; skipCount: number }> {
    let buyCount  = 0;
    let skipCount = 0;

    const currentHeld = new Set(holdingsAfterSell.map((h) => h.ticker));
    const openSlots = Math.max(0, MAX_HOLDINGS - currentHeld.size);

    if (openSlots === 0) {
      console.log("[TradingEngine] 보유 최대(5) — 매수 생략");
      return { buyCount: 0, skipCount: 0 };
    }
    if (availableCash <= 0) {
      console.log("[TradingEngine] 가용 예수금 없음 — 매수 생략");
      return { buyCount: 0, skipCount: 0 };
    }

    const budgetPerSlot = Math.floor(availableCash / openSlots);
    console.log(`[TradingEngine] 매수 슬롯=${openSlots}, 슬롯예산=${budgetPerSlot.toLocaleString()}원/종목`);

    let boughtCount = 0;

    for (const rec of top20) {
      if (boughtCount >= openSlots) break;
      if (currentHeld.has(rec.ticker)) continue;

      // 현재가 조회 (시장가 사이징 — 예수금 초과 방지)
      let currentPrice: number;
      try {
        const quote = await this.marketData.getQuote(rec.ticker);
        if (!quote?.price || quote.price <= 0) {
          skipCount++;
          details.push({ ticker: rec.ticker, name: rec.name, action: "SKIP", reason: "현재가 조회 실패 — 매수 스킵" });
          continue;
        }
        currentPrice = quote.price;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipCount++;
        details.push({ ticker: rec.ticker, name: rec.name, action: "SKIP", reason: `시세 조회 예외: ${msg}`, error: msg });
        continue;
      }

      const quantity = Math.floor(budgetPerSlot / currentPrice);
      if (quantity < 1) {
        skipCount++;
        details.push({
          ticker: rec.ticker, name: rec.name, action: "SKIP",
          reason: `예산 부족 — 주가 ${currentPrice.toLocaleString()}원 > 슬롯예산 ${budgetPerSlot.toLocaleString()}원`,
        });
        continue;
      }

      try {
        const result: OrderResult = await this.broker.placeOrder({
          clientOrderId:  this.clientOrderId(userId, runDate, "BUY", rec.ticker),
          ticker:         rec.ticker,
          name:           rec.name,
          side:           "BUY",
          quantity,
          type:           "MARKET",
          referencePrice: currentPrice,
        });

        if (result.status === "FILLED") {
          buyCount++;
          boughtCount++;
          currentHeld.add(rec.ticker);
          const reason = `Top${rec.rank} 편입 — 30일 기대수익 ${rec.baseReturn30d.toFixed(2)}%`;
          details.push({
            ticker: rec.ticker, name: rec.name, action: "BUY",
            reason: result.duplicate ? `${reason} (이미 체결됨)` : reason,
            qty: quantity, price: currentPrice, amount: result.filledAmount,
          });
          console.log(`[TradingEngine] 매수 ${result.duplicate ? "(중복무시)" : "체결"}: ${rec.ticker}(Top${rec.rank}) ${quantity}주 @${currentPrice.toLocaleString()}원`);
        } else {
          skipCount++;
          details.push({ ticker: rec.ticker, name: rec.name, action: "SKIP", reason: `매수 실패: ${result.error}`, error: result.error });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipCount++;
        details.push({ ticker: rec.ticker, name: rec.name, action: "SKIP", reason: `매수 예외: ${msg}`, error: msg });
        console.error(`[TradingEngine] 매수 예외 [${rec.ticker}]: ${msg}`);
      }
    }

    return { buyCount, skipCount };
  }
}
