/**
 * 자동매매 엔진 — 모의 투자용
 *
 * 전략: Prophet Top30(매수 추천) × TFT 기술 신호 복합
 *   매수: Prophet buy/strong_buy AND TFT buy/strong_buy
 *   매도: 보유 종목 중 TFT sell/strong_sell → 전량 청산
 *   포지션: 총 현금의 (1/가능슬롯)씩, 최대 10 종목
 */

import { supabase } from "./supabase";
import { getQuote }  from "./yahoo-finance";
import { analyzeTft } from "./tft-analysis";
import type { QuoteData } from "./yahoo-finance";

const MAX_POSITIONS = 10;
const INITIAL_CASH  = 10_000_000;

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface TradeDetail {
  ticker: string;
  name:   string;
  action: "BUY" | "SELL" | "SKIP";
  reason: string;
  qty?:   number;
  price?: number;
}

export interface AutoTradeResult {
  tickers_analyzed: number;
  trades_buy:       number;
  trades_sell:      number;
  skipped:          number;
  details:          TradeDetail[];
  error?:           string;
}

type TftResult = Awaited<ReturnType<typeof analyzeTft>>;

interface MockPosition {
  ticker:    string;
  name:      string;
  quantity:  number;
  avg_price: number;
}

// ── Prophet 최신 추천 종목 조회 ──────────────────────────────────────────────

async function getLatestProphetRecs(): Promise<{ ticker: string; name: string; recommendation: string }[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  const { data } = await supabase
    .from("prophet_recommendations")
    .select("ticker, name, recommendation, run_date")
    .gte("run_date", since)
    .order("run_date", { ascending: false })
    .order("rank",     { ascending: true });

  if (!data?.length) return [];

  const latestDate = data[0].run_date;
  return data
    .filter(r => r.run_date === latestDate && ["buy", "strong_buy"].includes(r.recommendation))
    .map(r => ({ ticker: r.ticker, name: r.name, recommendation: r.recommendation }));
}

// ── 사용자 계좌 조회 (없으면 생성) ───────────────────────────────────────────

async function getOrCreateAccount(userId: string): Promise<{ cash: number; auto_trade_capital: number | null } | null> {
  // SELECT-first: 기존 계좌 조회 (99%의 경우 1 왕복으로 종료)
  const { data: existing } = await supabase
    .from("mock_accounts")
    .select("cash, auto_trade_capital")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) return existing;

  // 최초 접근 시에만 INSERT
  const { data } = await supabase
    .from("mock_accounts")
    .insert({ user_id: userId, cash: INITIAL_CASH })
    .select("cash, auto_trade_capital")
    .single();

  return data;
}

// ── 거래 실행 (RPC 사용 — 원자적 단일 왕복) ─────────────────────────────────

async function executeBuy(userId: string, ticker: string, name: string, qty: number, price: number): Promise<void> {
  const { error } = await supabase.rpc("execute_mock_buy", {
    p_user_id:  userId,
    p_ticker:   ticker,
    p_name:     name,
    p_quantity: qty,
    p_price:    price,
  });
  if (error) throw new Error(`매수 실패 [${ticker}]: ${error.message}`);
}

async function executeSell(userId: string, ticker: string, name: string, qty: number, price: number): Promise<void> {
  const { error } = await supabase.rpc("execute_mock_sell", {
    p_user_id:  userId,
    p_ticker:   ticker,
    p_name:     name,
    p_quantity: qty,
    p_price:    price,
  });
  if (error) throw new Error(`매도 실패 [${ticker}]: ${error.message}`);
}

// ── 메인 엔진 ─────────────────────────────────────────────────────────────────

export async function runAutoTrade(userId: string): Promise<AutoTradeResult> {
  const details: TradeDetail[] = [];
  let trades_buy = 0, trades_sell = 0, skipped = 0;

  try {
    // 1. 계좌 + 포지션 + Prophet 추천 동시 조회 (3 병렬)
    const [account, { data: positionsRaw }, prophetRecs] = await Promise.all([
      getOrCreateAccount(userId),
      supabase.from("mock_positions")
        .select("ticker, name, quantity, avg_price")
        .eq("user_id", userId),
      getLatestProphetRecs(),
    ]);

    if (!account) throw new Error("계좌 조회 실패");

    const positions = (positionsRaw ?? []) as MockPosition[];
    const heldTickers = new Set(positions.map(p => p.ticker));

    const buyCandidates  = prophetRecs.filter(r => !heldTickers.has(r.ticker));
    const sellCandidates = positions;

    const allTickers = [...new Set([
      ...buyCandidates.map(r => r.ticker),
      ...sellCandidates.map(p => p.ticker),
    ])];

    // 2. TFT 분석 + 시세 조회 동시 실행 (최대 병렬)
    const [tftResults, quoteResults] = await Promise.all([
      Promise.allSettled(allTickers.map(t => analyzeTft(t))),
      Promise.allSettled(allTickers.map(t => getQuote(t))),
    ]);

    const tftMap   = new Map<string, TftResult>();
    const quoteMap = new Map<string, QuoteData>();
    allTickers.forEach((t, i) => {
      const tr = tftResults[i];
      if (tr.status === "fulfilled") tftMap.set(t, tr.value);
      const qr = quoteResults[i];
      if (qr.status === "fulfilled" && qr.value) quoteMap.set(t, qr.value);
    });

    // 3. 매도 처리 (캐시된 시세 사용 — await 없음)
    for (const pos of sellCandidates) {
      const tft = tftMap.get(pos.ticker);
      if (!tft || tft.insufficient_data) {
        skipped++;
        details.push({ ticker: pos.ticker, name: pos.name, action: "SKIP", reason: "TFT 데이터 부족" });
        continue;
      }

      if (tft.signal === "sell" || tft.signal === "strong_sell") {
        const quote = quoteMap.get(pos.ticker);
        if (!quote?.price) {
          skipped++;
          details.push({ ticker: pos.ticker, name: pos.name, action: "SKIP", reason: "시세 조회 실패" });
          continue;
        }

        const price = Math.round(quote.price * 100) / 100;
        await executeSell(userId, pos.ticker, pos.name, pos.quantity, price);
        trades_sell++;
        heldTickers.delete(pos.ticker);
        details.push({
          ticker: pos.ticker, name: pos.name, action: "SELL",
          reason: `TFT ${tft.signal} (점수: ${tft.composite_score})`,
          qty: pos.quantity, price,
        });
      } else {
        skipped++;
        details.push({ ticker: pos.ticker, name: pos.name, action: "SKIP", reason: `TFT ${tft.signal} — 보유 유지` });
      }
    }

    // 4. 매수 처리 (캐시된 시세 사용 — await 없음)
    const availableSlots = MAX_POSITIONS - heldTickers.size;
    if (availableSlots > 0 && buyCandidates.length > 0 && account.cash > 0) {
      // 매도 후 최신 현금 재조회
      const { data: refreshed } = await supabase
        .from("mock_accounts").select("cash, auto_trade_capital").eq("user_id", userId).single();
      const currentCash   = refreshed?.cash ?? account.cash;
      const capital       = refreshed?.auto_trade_capital ?? account.auto_trade_capital ?? null;
      const effectiveBudget = capital !== null ? Math.min(currentCash, capital) : currentCash;
      const budget        = Math.floor(effectiveBudget / Math.max(1, availableSlots));

      let boughtCount = 0;
      for (const candidate of buyCandidates) {
        if (boughtCount >= availableSlots) break;

        const tft = tftMap.get(candidate.ticker);
        if (!tft || tft.insufficient_data) {
          skipped++;
          details.push({ ticker: candidate.ticker, name: candidate.name, action: "SKIP", reason: "TFT 데이터 부족" });
          continue;
        }
        if (tft.signal !== "buy" && tft.signal !== "strong_buy") {
          skipped++;
          details.push({ ticker: candidate.ticker, name: candidate.name, action: "SKIP", reason: `TFT ${tft.signal} — 매수 조건 미충족` });
          continue;
        }

        const quote = quoteMap.get(candidate.ticker);
        if (!quote?.price || quote.price <= 0) {
          skipped++;
          details.push({ ticker: candidate.ticker, name: candidate.name, action: "SKIP", reason: "시세 조회 실패" });
          continue;
        }

        const price = Math.round(quote.price * 100) / 100;
        const qty   = Math.floor(budget / price);
        if (qty < 1) {
          skipped++;
          details.push({ ticker: candidate.ticker, name: candidate.name, action: "SKIP", reason: `현금 부족 (${budget.toLocaleString()}원, 주가 ${price.toLocaleString()}원)` });
          continue;
        }

        await executeBuy(userId, candidate.ticker, candidate.name, qty, price);
        trades_buy++;
        boughtCount++;
        details.push({
          ticker: candidate.ticker, name: candidate.name, action: "BUY",
          reason: `Prophet ${candidate.recommendation} + TFT ${tft.signal} (점수: ${tft.composite_score})`,
          qty, price,
        });
      }
    }

    // 5. 로그 기록
    await supabase.from("mock_auto_trade_logs").insert({
      user_id:          userId,
      tickers_analyzed: allTickers.length,
      trades_buy,
      trades_sell,
      skipped,
      details:          JSON.stringify(details.slice(0, 50)), // JSONB 크기 제한
    });

    return { tickers_analyzed: allTickers.length, trades_buy, trades_sell, skipped, details };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await supabase.from("mock_auto_trade_logs").insert({
        user_id: userId, tickers_analyzed: 0, trades_buy: 0, trades_sell: 0, skipped: 0,
        details: "[]", error: msg,
      });
    } catch { /* 로그 실패는 무시 */ }
    return { tickers_analyzed: 0, trades_buy: 0, trades_sell: 0, skipped: 0, details: [], error: msg };
  }
}
