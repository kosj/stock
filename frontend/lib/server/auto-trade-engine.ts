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

const MAX_POSITIONS  = 10;
const INITIAL_CASH   = 10_000_000;

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface TradeDetail {
  ticker:  string;
  name:    string;
  action:  "BUY" | "SELL" | "SKIP";
  reason:  string;
  qty?:    number;
  price?:  number;
}

export interface AutoTradeResult {
  tickers_analyzed: number;
  trades_buy:       number;
  trades_sell:      number;
  skipped:          number;
  details:          TradeDetail[];
  error?:           string;
}

// ── Prophet 최신 추천 종목 조회 ──────────────────────────────────────────────

async function getLatestProphetRecs(): Promise<{ ticker: string; name: string; recommendation: string }[]> {
  // 최근 7일 이내 가장 최신 run_date 기준
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  const { data } = await supabase
    .from("prophet_recommendations")
    .select("ticker, name, recommendation, run_date")
    .gte("run_date", since)
    .order("run_date", { ascending: false })
    .order("rank",     { ascending: true });

  if (!data?.length) return [];

  // 가장 최신 run_date만 사용
  const latestDate = data[0].run_date;
  return data
    .filter(r => r.run_date === latestDate && ["buy", "strong_buy"].includes(r.recommendation))
    .map(r => ({ ticker: r.ticker, name: r.name, recommendation: r.recommendation }));
}

// ── 사용자 계좌 조회 (없으면 생성) ───────────────────────────────────────────

async function getOrCreateAccount(userId: string): Promise<{ cash: number; auto_trade_capital: number | null } | null> {
  let { data: account } = await supabase
    .from("mock_accounts").select("cash, auto_trade_capital").eq("user_id", userId).single();
  if (!account) {
    const { data: created } = await supabase
      .from("mock_accounts")
      .insert({ user_id: userId, cash: INITIAL_CASH })
      .select("cash, auto_trade_capital").single();
    account = created;
  }
  return account;
}

// ── 거래 실행 (내부용 — DB 직접 조작) ────────────────────────────────────────

async function executeBuy(
  userId: string, ticker: string, name: string, qty: number, price: number,
): Promise<void> {
  const total = Math.round(price * qty);
  const today = new Date().toISOString();

  // 기존 포지션 확인
  const { data: existing } = await supabase
    .from("mock_positions").select("*").eq("user_id", userId).eq("ticker", ticker).single();

  if (existing) {
    const new_qty = existing.quantity + qty;
    const new_avg = ((existing.avg_price * existing.quantity) + total) / new_qty;
    await supabase.from("mock_positions").update({
      quantity: new_qty, avg_price: Math.round(new_avg * 100) / 100, updated_at: today,
    }).eq("user_id", userId).eq("ticker", ticker);
  } else {
    await supabase.from("mock_positions").insert({
      user_id: userId, ticker, name, quantity: qty, avg_price: price, updated_at: today,
    });
  }

  // 현금 차감
  const { data: acct } = await supabase.from("mock_accounts").select("cash").eq("user_id", userId).single();
  if (acct) {
    await supabase.from("mock_accounts").update({ cash: acct.cash - total, updated_at: today }).eq("user_id", userId);
  }

  await supabase.from("mock_trades").insert({
    user_id: userId, ticker, name, trade_type: "BUY", quantity: qty, price, total_amount: total,
  });
}

async function executeSell(
  userId: string, ticker: string, name: string, qty: number, price: number,
): Promise<void> {
  const total = Math.round(price * qty);
  const today = new Date().toISOString();

  await supabase.from("mock_positions").delete().eq("user_id", userId).eq("ticker", ticker);

  // 현금 증가
  const { data: acct } = await supabase.from("mock_accounts").select("cash").eq("user_id", userId).single();
  if (acct) {
    await supabase.from("mock_accounts").update({ cash: acct.cash + total, updated_at: today }).eq("user_id", userId);
  }

  await supabase.from("mock_trades").insert({
    user_id: userId, ticker, name, trade_type: "SELL", quantity: qty, price, total_amount: total,
  });
}

// ── 메인 엔진 ─────────────────────────────────────────────────────────────────

export async function runAutoTrade(userId: string): Promise<AutoTradeResult> {
  const details: TradeDetail[] = [];
  let trades_buy = 0, trades_sell = 0, skipped = 0;

  try {
    // 1. 계좌 + 포지션 조회
    const [account, { data: positionsRaw }] = await Promise.all([
      getOrCreateAccount(userId),
      supabase.from("mock_positions").select("*").eq("user_id", userId),
    ]);

    if (!account) throw new Error("계좌 조회 실패");

    const positions = positionsRaw ?? [];
    const heldTickers = new Set(positions.map(p => p.ticker));

    // 2. Prophet Top30 매수 추천 목록
    const prophetRecs = await getLatestProphetRecs();

    // 3. 매도 후보: 현재 보유 종목
    // 4. 매수 후보: Prophet 추천 중 미보유
    const buyCandidates = prophetRecs.filter(r => !heldTickers.has(r.ticker));
    const sellCandidates = positions;

    // 5. 분석 대상 전체 ticker 목록 TFT 병렬 분석
    const allTickers = [
      ...new Set([
        ...buyCandidates.map(r => r.ticker),
        ...sellCandidates.map(p => p.ticker),
      ]),
    ];

    const tftResults = await Promise.allSettled(allTickers.map(t => analyzeTft(t)));
    const tftMap = new Map<string, Awaited<ReturnType<typeof analyzeTft>>>();
    allTickers.forEach((t, i) => {
      const r = tftResults[i];
      if (r.status === "fulfilled") tftMap.set(t, r.value);
    });

    // 6. 매도 처리: 보유 종목 중 TFT sell/strong_sell
    for (const pos of sellCandidates) {
      const tft = tftMap.get(pos.ticker);
      if (!tft || tft.insufficient_data) {
        skipped++;
        details.push({ ticker: pos.ticker, name: pos.name, action: "SKIP", reason: "TFT 데이터 부족" });
        continue;
      }

      if (tft.signal === "sell" || tft.signal === "strong_sell") {
        const quote = await getQuote(pos.ticker).catch(() => null);
        if (!quote?.price) {
          skipped++;
          details.push({ ticker: pos.ticker, name: pos.name, action: "SKIP", reason: "시세 조회 실패" });
          continue;
        }

        await executeSell(userId, pos.ticker, pos.name, pos.quantity, Math.round(quote.price * 100) / 100);
        trades_sell++;
        heldTickers.delete(pos.ticker); // 매도 후 보유 목록에서 제거
        details.push({
          ticker: pos.ticker, name: pos.name, action: "SELL",
          reason: `TFT ${tft.signal} (점수: ${tft.composite_score})`,
          qty: pos.quantity, price: quote.price,
        });
      } else {
        skipped++;
        details.push({ ticker: pos.ticker, name: pos.name, action: "SKIP", reason: `TFT ${tft.signal} — 보유 유지` });
      }
    }

    // 7. 매수 처리: Prophet buy + TFT buy
    const availableSlots = MAX_POSITIONS - heldTickers.size;
    if (availableSlots > 0 && buyCandidates.length > 0 && account.cash > 0) {
      // 계좌 재조회 (매도로 현금 증가됐을 수 있음)
      const { data: refreshed } = await supabase
        .from("mock_accounts").select("cash, auto_trade_capital").eq("user_id", userId).single();
      const currentCash = refreshed?.cash ?? account.cash;

      // 자본금 한도: 설정된 경우 min(보유현금, 자본금), 미설정이면 전체 현금
      const capital = refreshed?.auto_trade_capital ?? account.auto_trade_capital ?? null;
      const effectiveBudget = capital !== null ? Math.min(currentCash, capital) : currentCash;

      const budget = Math.floor(effectiveBudget / Math.max(1, availableSlots));

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

        const quote = await getQuote(candidate.ticker).catch(() => null);
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

    // 8. 로그 기록
    await supabase.from("mock_auto_trade_logs").insert({
      user_id:          userId,
      tickers_analyzed: allTickers.length,
      trades_buy,
      trades_sell,
      skipped,
      details:          JSON.stringify(details),
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
