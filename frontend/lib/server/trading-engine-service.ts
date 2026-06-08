/**
 * TradingEngineService — Top 30 기반 자동매매 엔진
 *
 * 전략: Sell First → Buy Next
 *   매도 조건 (3가지 중 하나라도 해당):
 *     1. 손절(Stop-loss):  수익률 ≤ -5%
 *     2. 익절(Take-profit): 수익률 ≥ +10%
 *     3. 랭크아웃:          오늘의 Top 30 리스트에 미포함
 *   매수 조건:
 *     - Top 30 리스트에서 rank 순으로, 미보유 종목만 빈 슬롯(최대 5개)까지 균등 비중 매수
 */

import { supabase } from "./supabase";
import { getQuote } from "./yahoo-finance";

// ── 상수 ─────────────────────────────────────────────────────────────────────

/** 최대 동시 보유 종목 수 */
const MAX_HOLDINGS = 5;

/** 손절 기준 수익률 (%) */
const STOP_LOSS_PCT = -5;

/** 익절 기준 수익률 (%) */
const TAKE_PROFIT_PCT = 10;

/** 계좌 초기 잔고 (원) */
const INITIAL_CASH = 10_000_000;

// ── 타입 정의 ─────────────────────────────────────────────────────────────────

/** prophet_recommendations 테이블 레코드 */
export interface Recommendation {
  rank:            number;
  ticker:          string;
  name:            string;
  recommendation:  string;
  current_price:   number;
  base_return_30d: number;
}

/** 계좌 잔고 정보 */
export interface AccountBalance {
  cash:                number;
  auto_trade_capital:  number | null;
}

/** 보유 종목 (현재가·수익률 포함) */
export interface Holding {
  ticker:        string;
  name:          string;
  quantity:      number;
  avg_price:     number;
  current_price: number;
  /** 수익률 (%), 소수점 2자리 반올림 */
  pnl_pct:       number;
}

/**
 * 자동매매 실행 로그 한 줄 (UI의 AutoTradeDetail 타입과 호환)
 * action이 BUY/SELL 이면 실제 체결, SKIP 이면 조건 미충족 또는 실패
 */
export interface TradeDetail {
  ticker:   string;
  name:     string;
  action:   "BUY" | "SELL" | "SKIP";
  reason:   string;
  qty?:     number;
  price?:   number;
  /** 체결 금액 (원) — UI 미사용이지만 로그 확인용 */
  amount?:  number;
  /** 주문 실패 시 에러 메시지 */
  error?:   string;
}

/** executeTrading() 반환 타입 (기존 AutoTradeResult와 동일 구조) */
export interface TradingResult {
  tickers_analyzed: number;
  trades_buy:       number;
  trades_sell:      number;
  skipped:          number;
  details:          TradeDetail[];
  error?:           string;
}

// ── BrokerApiService 인터페이스 ───────────────────────────────────────────────
// 실제 증권사 API(KIS, eBest 등) 연동 시 이 인터페이스만 새로 구현하면 됨.
// 현재는 MockBrokerApiService(Supabase RPC)가 기본 구현체.

export interface BrokerApiService {
  /** 계좌 현금 잔고 및 자동매매 투입 자본 조회 */
  getAccountBalance(userId: string): Promise<AccountBalance>;

  /** 현재 보유 종목 전체 조회 (현재가·수익률 포함) */
  getHoldings(userId: string): Promise<Holding[]>;

  /**
   * 시장가(최유리 지정가) 전량 매도
   * @returns success=true이면 amount에 체결 금액(원) 반환
   */
  placeMarketSellOrder(
    userId:   string,
    ticker:   string,
    name:     string,
    quantity: number,
    price:    number,
  ): Promise<{ success: boolean; amount: number; error?: string }>;

  /**
   * 시장가 매수
   * @returns success=true이면 정상 체결
   */
  placeMarketBuyOrder(
    userId:   string,
    ticker:   string,
    name:     string,
    quantity: number,
    price:    number,
  ): Promise<{ success: boolean; error?: string }>;
}

// ── SupabaseRepository ────────────────────────────────────────────────────────
// DB 접근을 한 곳에 모아 SRP(단일 책임 원칙) 준수

export class SupabaseRepository {
  /**
   * 가장 최근 run_date 기준 Top 30 추천 종목 조회
   *
   * 쿼리 전략:
   *   1단계 — LIMIT 1으로 최신 run_date만 조회 (풀스캔 방지)
   *   2단계 — 해당 날짜의 rank 1~30 레코드를 rank ASC 정렬로 조회
   */
  async getTop30Recommendations(): Promise<Recommendation[]> {
    // 1단계: 가장 최신 분석 날짜 조회
    const { data: latest } = await supabase
      .from("prophet_recommendations")
      .select("run_date")
      .order("run_date", { ascending: false })
      .limit(1)
      .single();

    if (!latest?.run_date) return [];

    // 2단계: 해당 날짜의 Top 30 전체 조회
    const { data, error } = await supabase
      .from("prophet_recommendations")
      .select("rank, ticker, name, recommendation, current_price, base_return_30d")
      .eq("run_date", latest.run_date)
      .order("rank", { ascending: true })
      .limit(30);

    if (error || !data) return [];
    return data as Recommendation[];
  }
}

// ── MockBrokerApiService ──────────────────────────────────────────────────────
// Supabase RPC + Yahoo Finance를 증권사 API처럼 래핑한 모의 투자 구현체

export class MockBrokerApiService implements BrokerApiService {
  /**
   * 모의 계좌 현금 잔고 조회
   * 계좌가 없으면 INITIAL_CASH로 자동 생성(upsert → ignoreDuplicates)
   */
  async getAccountBalance(userId: string): Promise<AccountBalance> {
    // ignoreDuplicates=true → 이미 있으면 기존 행 유지, 없으면 INSERT
    await supabase
      .from("mock_accounts")
      .upsert(
        { user_id: userId, cash: INITIAL_CASH },
        { onConflict: "user_id", ignoreDuplicates: true },
      );

    const { data } = await supabase
      .from("mock_accounts")
      .select("cash, auto_trade_capital")
      .eq("user_id", userId)
      .single();

    return {
      cash:               data?.cash               ?? INITIAL_CASH,
      auto_trade_capital: data?.auto_trade_capital ?? null,
    };
  }

  /**
   * 보유 종목 + 현재가 + 수익률 조회
   *
   * mock_positions 전체를 가져온 뒤, 각 종목의 현재가를 Yahoo Finance에서
   * Promise.allSettled로 병렬 조회한다.
   * 현재가 조회에 실패한 종목은 avg_price로 대체 → 수익률 0% 표시.
   */
  async getHoldings(userId: string): Promise<Holding[]> {
    const { data: positions } = await supabase
      .from("mock_positions")
      .select("ticker, name, quantity, avg_price")
      .eq("user_id", userId);

    if (!positions?.length) return [];

    // 모든 보유 종목 시세를 병렬로 조회 (부분 실패 허용)
    const quoteResults = await Promise.allSettled(
      positions.map((p) => getQuote(p.ticker)),
    );

    return positions.map((pos, i) => {
      const qr = quoteResults[i];
      // 조회 성공이고 유효한 가격이면 사용, 아니면 avg_price로 대체
      const currentPrice =
        qr.status === "fulfilled" && qr.value?.price && qr.value.price > 0
          ? qr.value.price
          : pos.avg_price;

      // 수익률 계산: (현재가 - 평균단가) / 평균단가 × 100
      const pnlPct =
        pos.avg_price > 0
          ? ((currentPrice - pos.avg_price) / pos.avg_price) * 100
          : 0;

      return {
        ticker:        pos.ticker,
        name:          pos.name,
        quantity:      pos.quantity,
        avg_price:     pos.avg_price,
        current_price: currentPrice,
        pnl_pct:       Math.round(pnlPct * 100) / 100,
      };
    });
  }

  /**
   * 시장가 전량 매도
   * Supabase RPC execute_mock_sell 호출 → DB 트랜잭션으로 포지션 감소 + 현금 증가
   * RPC 에러 메시지 형식: "no_position" | "insufficient_quantity:보유수:요청수"
   */
  async placeMarketSellOrder(
    userId:   string,
    ticker:   string,
    name:     string,
    quantity: number,
    price:    number,
  ): Promise<{ success: boolean; amount: number; error?: string }> {
    const { error } = await supabase.rpc("execute_mock_sell", {
      p_user_id:  userId,
      p_ticker:   ticker,
      p_name:     name,
      p_quantity: quantity,
      p_price:    price,
    });

    if (error) return { success: false, amount: 0, error: error.message };

    // 체결 금액 = 수량 × 가격 (소수점 제거)
    return { success: true, amount: Math.round(quantity * price) };
  }

  /**
   * 시장가 매수
   * Supabase RPC execute_mock_buy 호출 → DB 트랜잭션으로 포지션 증가 + 현금 감소
   * RPC 에러 메시지 형식: "insufficient_cash:현재잔금:필요금액"
   */
  async placeMarketBuyOrder(
    userId:   string,
    ticker:   string,
    name:     string,
    quantity: number,
    price:    number,
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await supabase.rpc("execute_mock_buy", {
      p_user_id:  userId,
      p_ticker:   ticker,
      p_name:     name,
      p_quantity: quantity,
      p_price:    price,
    });

    if (error) return { success: false, error: error.message };
    return { success: true };
  }
}

// ── TradingEngineService ──────────────────────────────────────────────────────
// 핵심 매매 오케스트레이터: Sell First → Buy Next 전략 실행기

export class TradingEngineService {
  private readonly repo:   SupabaseRepository;
  private readonly broker: BrokerApiService;

  /**
   * @param broker 브로커 구현체. 미지정 시 모의 투자(MockBrokerApiService)를 사용.
   *               실제 증권사 API 연동 시 새 구현체를 주입하면 됨 (DI 패턴).
   */
  constructor(broker?: BrokerApiService) {
    this.repo   = new SupabaseRepository();
    this.broker = broker ?? new MockBrokerApiService();
  }

  // ── 퍼블릭 진입점 ─────────────────────────────────────────────────────────

  /**
   * executeTrading: 자동매매 전체 파이프라인 실행
   *
   * 실행 순서:
   *   [Step 1] 사전 데이터 수집 — Top 30 + 계좌 잔고 + 보유 종목 병렬 조회
   *   [Step 2] executeSells()  — 매도 조건 판별 후 전량 청산 (Sell First)
   *   [Step 3] executeBuys()   — 매도로 확보한 현금으로 Top 30 신규 매수 (Buy Next)
   *   [Step 4] 실행 결과를 mock_auto_trade_logs에 기록
   */
  async executeTrading(userId: string): Promise<TradingResult> {
    const details: TradeDetail[] = [];
    let trades_buy  = 0;
    let trades_sell = 0;
    let skipped     = 0;

    try {
      // ── Step 1: 사전 데이터 병렬 수집 ────────────────────────────────────
      // Top30 추천 목록 / 계좌 잔고 / 보유 종목을 동시에 조회해 레이턴시를 최소화함
      console.log(`[TradingEngine] 시작 — userId=${userId}`);

      const [top30, account, holdings] = await Promise.all([
        this.repo.getTop30Recommendations(),
        this.broker.getAccountBalance(userId),
        this.broker.getHoldings(userId),
      ]);

      // Top30 데이터가 없으면 (Cron이 아직 미실행) 매매 불가
      if (!top30.length) {
        console.warn("[TradingEngine] Top30 추천 데이터 없음 — 종료");
        return {
          tickers_analyzed: 0,
          trades_buy:       0,
          trades_sell:      0,
          skipped:          0,
          details:          [],
        };
      }

      // Top 30 티커를 Set으로 변환 → O(1) 멤버십 조회에 활용 (랭크아웃 판별)
      const top30Set = new Set(top30.map((r) => r.ticker));

      // 가용 예수금 결정:
      //   auto_trade_capital이 설정된 경우 → min(현금, 설정 자본)
      //   설정되지 않은 경우              → 전체 현금
      let availableCash =
        account.auto_trade_capital !== null
          ? Math.min(account.cash, account.auto_trade_capital)
          : account.cash;

      console.log(
        `[TradingEngine] Top30=${top30.length}종목, ` +
        `보유=${holdings.length}종목, ` +
        `가용예수금=${availableCash.toLocaleString()}원`,
      );

      // ── Step 2: 매도 먼저 실행 (Sell First 규칙) ─────────────────────────
      // 반드시 매수보다 먼저 실행해야 매도 대금을 매수에 재투입할 수 있음
      const sellResult = await this.executeSells(userId, holdings, top30Set, details);
      trades_sell   = sellResult.sellCount;
      skipped      += sellResult.skipCount;
      availableCash += sellResult.cashRecovered; // 매도 체결 대금을 가용 예수금에 합산

      console.log(
        `[TradingEngine] 매도 완료 — ${trades_sell}건 체결, ` +
        `회수=${sellResult.cashRecovered.toLocaleString()}원, ` +
        `가용예수금=${availableCash.toLocaleString()}원`,
      );

      // ── Step 3: 매수 실행 (Buy Next 규칙) ────────────────────────────────
      // 매도 후 최신 보유 종목을 재조회해서 정확한 슬롯 수를 계산함
      // (매도 실패 종목이 있을 수 있으므로 캐시된 holdings를 재사용하지 않음)
      const holdingsAfterSell = await this.broker.getHoldings(userId);
      const buyResult = await this.executeBuys(
        userId,
        top30,
        holdingsAfterSell,
        availableCash,
        details,
      );
      trades_buy = buyResult.buyCount;
      skipped   += buyResult.skipCount;

      console.log(`[TradingEngine] 매수 완료 — ${trades_buy}건 체결`);

      // ── Step 4: 실행 로그 기록 ────────────────────────────────────────────
      // 분석 종목 수 = 보유 종목과 Top30의 합집합 (중복 제거)
      const tickers_analyzed = new Set([
        ...holdings.map((h) => h.ticker),
        ...top30.map((r) => r.ticker),
      ]).size;

      await supabase.from("mock_auto_trade_logs").insert({
        user_id:          userId,
        tickers_analyzed,
        trades_buy,
        trades_sell,
        skipped,
        details:          JSON.stringify(details.slice(0, 50)), // JSONB 크기 제한
      });

      return { tickers_analyzed, trades_buy, trades_sell, skipped, details };

    } catch (err) {
      // 파이프라인 자체가 예기치 않게 실패한 경우 — 에러 로그를 남기고 반환
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[TradingEngine] 치명적 오류: ${msg}`);

      try {
        await supabase.from("mock_auto_trade_logs").insert({
          user_id: userId, tickers_analyzed: 0,
          trades_buy: 0, trades_sell: 0, skipped: 0,
          details: "[]", error: msg,
        });
      } catch { /* 로그 기록 실패는 무시 */ }

      return {
        tickers_analyzed: 0,
        trades_buy:       0,
        trades_sell:      0,
        skipped:          0,
        details:          [],
        error:            msg,
      };
    }
  }

  // ── 프라이빗: 매도 로직 ───────────────────────────────────────────────────

  /**
   * executeSells: 보유 종목 전체를 순회하며 3가지 매도 조건을 판별하고 전량 청산
   *
   * 매도 조건 (OR — 하나라도 해당 시 즉시 매도):
   *   1. 손절(Stop-loss):   pnl_pct ≤ STOP_LOSS_PCT  (-5%)
   *   2. 익절(Take-profit): pnl_pct ≥ TAKE_PROFIT_PCT (+10%)
   *   3. 랭크아웃:           해당 티커가 오늘의 Top 30에 없음
   *
   * 개별 종목 주문이 실패해도 try-catch로 격리 → 나머지 종목 계속 처리
   *
   * @returns sellCount 체결된 매도 건수 / skipCount 스킵 건수 / cashRecovered 회수 현금
   */
  private async executeSells(
    userId:    string,
    holdings:  Holding[],
    top30Set:  Set<string>,
    details:   TradeDetail[],
  ): Promise<{ sellCount: number; skipCount: number; cashRecovered: number }> {
    let sellCount     = 0;
    let skipCount     = 0;
    let cashRecovered = 0;

    for (const h of holdings) {
      // ─ 3가지 매도 조건 판별 ────────────────────────────────────────────

      // 조건 1: 손절 — 기계적 리스크 관리. 시장 급락 시 손실 제한
      const isStopLoss = h.pnl_pct <= STOP_LOSS_PCT;

      // 조건 2: 익절 — 목표 수익 달성 시 즉시 실현. "욕심을 버린다"
      const isTakeProfit = h.pnl_pct >= TAKE_PROFIT_PCT;

      // 조건 3: 랭크아웃 — 오늘의 Top 30 밖으로 밀려난 종목 교체 (추세 이탈)
      const isRankOut = !top30Set.has(h.ticker);

      // 세 조건 모두 해당 없으면 보유 유지 → SKIP으로 기록
      if (!isStopLoss && !isTakeProfit && !isRankOut) {
        skipCount++;
        details.push({
          ticker: h.ticker,
          name:   h.name,
          action: "SKIP",
          reason: `보유 유지 (수익률 ${h.pnl_pct >= 0 ? "+" : ""}${h.pnl_pct.toFixed(2)}%, Top30 포함)`,
        });
        continue;
      }

      // ─ 매도 이유 문자열 조합 ─────────────────────────────────────────────
      const reasons: string[] = [];
      if (isStopLoss)   reasons.push(`손절 ${h.pnl_pct.toFixed(2)}% (기준: ${STOP_LOSS_PCT}%)`);
      if (isTakeProfit) reasons.push(`익절 +${h.pnl_pct.toFixed(2)}% (기준: +${TAKE_PROFIT_PCT}%)`);
      if (isRankOut)    reasons.push("랭크아웃 — Top30 미포함");
      const reason = reasons.join(" + ");

      // ─ 전량 매도 주문 실행 (개별 격리) ──────────────────────────────────
      try {
        const result = await this.broker.placeMarketSellOrder(
          userId, h.ticker, h.name, h.quantity, h.current_price,
        );

        if (result.success) {
          sellCount++;
          cashRecovered += result.amount; // 체결 대금 누적 → 매수 예산으로 전환

          details.push({
            ticker: h.ticker,
            name:   h.name,
            action: "SELL",
            reason,
            qty:    h.quantity,
            price:  h.current_price,
            amount: result.amount,
          });

          console.log(
            `[TradingEngine] 매도 체결: ${h.ticker} ${h.quantity}주 ` +
            `@${h.current_price.toLocaleString()}원 — ${reason}`,
          );
        } else {
          // RPC 실패 (no_position, insufficient_quantity 등)
          skipCount++;
          details.push({
            ticker: h.ticker,
            name:   h.name,
            action: "SKIP",
            reason: `매도 실패: ${result.error}`,
            error:  result.error,
          });
        }
      } catch (err) {
        // 네트워크 장애, 예기치 않은 예외 — 이 종목만 스킵하고 계속 진행
        const msg = err instanceof Error ? err.message : String(err);
        skipCount++;
        details.push({
          ticker: h.ticker,
          name:   h.name,
          action: "SKIP",
          reason: `매도 예외: ${msg}`,
          error:  msg,
        });
        console.error(`[TradingEngine] 매도 예외 [${h.ticker}]: ${msg}`);
      }
    }

    return { sellCount, skipCount, cashRecovered };
  }

  // ── 프라이빗: 매수 로직 ───────────────────────────────────────────────────

  /**
   * executeBuys: 빈 슬롯을 계산하고 Top 30 순서대로 미보유 종목 매수
   *
   * 매수 절차:
   *   1. 열린 슬롯 수 = MAX_HOLDINGS(5) - 현재 보유 종목 수
   *   2. 슬롯당 예산 = 총 가용 예수금 ÷ 열린 슬롯 수 (동일 비중 원칙)
   *   3. Top 30 리스트 rank 1위부터 순회:
   *      - 이미 보유 중 → 중복 방지로 건너뜀
   *      - Yahoo Finance에서 현재가 조회 실패 → SKIP
   *      - 1주 매수 예산 부족(주가 > 슬롯예산) → SKIP
   *      - 위 조건 통과 시 수량 = floor(슬롯예산 ÷ 현재가) 으로 매수
   *   4. 슬롯이 다 차면 루프 종료
   *
   * 개별 종목 주문이 실패해도 try-catch로 격리 → 나머지 계속 처리
   *
   * @returns buyCount 체결된 매수 건수 / skipCount 스킵 건수
   */
  private async executeBuys(
    userId:             string,
    top30:              Recommendation[],
    holdingsAfterSell:  Holding[],
    availableCash:      number,
    details:            TradeDetail[],
  ): Promise<{ buyCount: number; skipCount: number }> {
    let buyCount  = 0;
    let skipCount = 0;

    // 현재 보유 티커 Set — 중복 매수 방지 및 슬롯 계산에 사용
    const currentHeld = new Set(holdingsAfterSell.map((h) => h.ticker));

    // 남은 슬롯 수 = 최대 보유 종목 수 - 현재 보유 수
    const openSlots = Math.max(0, MAX_HOLDINGS - currentHeld.size);

    if (openSlots === 0) {
      console.log("[TradingEngine] 보유 종목이 최대(5개)이므로 매수 생략");
      return { buyCount: 0, skipCount: 0 };
    }

    if (availableCash <= 0) {
      console.log("[TradingEngine] 가용 예수금 없음 — 매수 생략");
      return { buyCount: 0, skipCount: 0 };
    }

    // 1종목당 배정 예산: 균등 비중. 소수점 버림으로 예수금 초과 방지
    const budgetPerSlot = Math.floor(availableCash / openSlots);

    console.log(
      `[TradingEngine] 매수 슬롯=${openSlots}개, ` +
      `슬롯예산=${budgetPerSlot.toLocaleString()}원/종목`,
    );

    // Top 30을 rank 오름차순(1위→30위)으로 순회하며 매수 종목 선정
    let boughtCount = 0;

    for (const rec of top30) {
      // 슬롯이 다 찼으면 남은 종목은 모두 건너뜀
      if (boughtCount >= openSlots) break;

      // 이미 보유 중인 종목은 중복 매수 금지
      if (currentHeld.has(rec.ticker)) continue;

      // ─ 현재가 조회 (Yahoo Finance 실시간) ────────────────────────────────
      // 모의 투자지만 실제 주가 기준으로 수량을 계산해야 예수금 초과를 방지함
      let currentPrice: number;
      try {
        const quote = await getQuote(rec.ticker);
        if (!quote?.price || quote.price <= 0) {
          // 조회 성공이지만 가격 없음 (장 마감 등)
          skipCount++;
          details.push({
            ticker: rec.ticker,
            name:   rec.name,
            action: "SKIP",
            reason: "현재가 조회 실패 — 매수 스킵",
          });
          continue;
        }
        currentPrice = quote.price;
      } catch (err) {
        // 네트워크 오류 등 예외
        const msg = err instanceof Error ? err.message : String(err);
        skipCount++;
        details.push({
          ticker: rec.ticker,
          name:   rec.name,
          action: "SKIP",
          reason: `시세 조회 예외: ${msg}`,
          error:  msg,
        });
        continue;
      }

      // ─ 매수 가능 수량 계산 ────────────────────────────────────────────────
      // floor() → 소수점 버림으로 슬롯 예산 초과를 원천 차단
      const quantity = Math.floor(budgetPerSlot / currentPrice);

      if (quantity < 1) {
        // 1주를 살 수 없는 경우(주가 > 슬롯 예산) — 해당 슬롯은 공석으로 남김
        skipCount++;
        details.push({
          ticker: rec.ticker,
          name:   rec.name,
          action: "SKIP",
          reason:
            `예산 부족 — 주가 ${currentPrice.toLocaleString()}원 > ` +
            `슬롯예산 ${budgetPerSlot.toLocaleString()}원`,
        });
        continue;
      }

      // ─ 매수 주문 실행 (개별 격리) ────────────────────────────────────────
      try {
        const result = await this.broker.placeMarketBuyOrder(
          userId, rec.ticker, rec.name, quantity, currentPrice,
        );
        const totalAmount = Math.round(quantity * currentPrice);

        if (result.success) {
          buyCount++;
          boughtCount++;
          // 즉시 currentHeld에 추가 → 동일 종목 중복 매수 방지
          currentHeld.add(rec.ticker);

          details.push({
            ticker: rec.ticker,
            name:   rec.name,
            action: "BUY",
            reason: `Top${rec.rank} 편입 — 30일 기대수익 ${rec.base_return_30d.toFixed(2)}%`,
            qty:    quantity,
            price:  currentPrice,
            amount: totalAmount,
          });

          console.log(
            `[TradingEngine] 매수 체결: ${rec.ticker}(Top${rec.rank}) ` +
            `${quantity}주 @${currentPrice.toLocaleString()}원 ` +
            `= ${totalAmount.toLocaleString()}원`,
          );
        } else {
          // insufficient_cash 등 RPC 오류
          skipCount++;
          details.push({
            ticker: rec.ticker,
            name:   rec.name,
            action: "SKIP",
            reason: `매수 실패: ${result.error}`,
            error:  result.error,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipCount++;
        details.push({
          ticker: rec.ticker,
          name:   rec.name,
          action: "SKIP",
          reason: `매수 예외: ${msg}`,
          error:  msg,
        });
        console.error(`[TradingEngine] 매수 예외 [${rec.ticker}]: ${msg}`);
      }
    }

    return { buyCount, skipCount };
  }
}
