/**
 * etf_pick_snapshot.mjs — ETF 추천 이력 스냅샷 적재
 * ============================================================================
 * 매 거래일 추천 결과를 etf_pick_history에 적재해, 주간 백테스트가 실현 성과를
 * 측정할 수 있게 한다. 추천은 지금까지 요청 시 즉석 계산돼 이력이 없었다.
 *
 * 실행 환경: GitHub Actions (네이버 목록 API 도달 확인됨).
 *   앱 서버(Vercel)를 호출하지 않고 동일 데이터·동일 산식을 여기서 재현한다 —
 *   앱이 내려가 있어도 이력이 끊기지 않고, 배포 URL/인증에 의존하지 않는다.
 *
 * 저장 범위:
 *   - 계좌: pension(연금 편입가능) / stock(제한 없음)
 *   - 기간: 3M (기본 추천 기간)
 *   - Top-N에는 rank 부여, 그 외 후보도 함께 저장 → 전체 순위 IC 측정 가능
 *
 * 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요");
  process.exit(1);
}

// ── 앱(etf-ranking-service.ts)과 동일한 상수·산식 ───────────────────────────
const MIN_TRADING_MW = 1000;      // 거래대금 10억원
const MIN_MARKETCAP_EOK = 500;    // 시총 500억원
const W_MOMENTUM = 0.65, W_RISKADJ = 0.35;
const RANK_Z_DENOM = 0.2887;      // 균등분포 이론 std(1/√12) — 유계 보장
const VOL_FLOOR_PCT = 2;
const VOL_CANDIDATES = 40;        // 모멘텀 상위 N만 변동성 산출
const TOP_N = 10;                 // rank를 부여할 상위 종목 수
const SAVE_LIMIT = 60;            // 저장할 후보 수(IC 측정을 위해 Top-N보다 넓게)

const TAB = { 1: "국내시장지수", 2: "국내업종테마", 3: "국내파생", 4: "해외주식", 5: "원자재", 6: "채권", 7: "기타" };

function classify(name, tab) {
  const n = name.replace(/\s/g, "").toUpperCase();
  const leveraged = name.includes("레버리지") || n.includes("2X") || name.includes("2배");
  const inverse = name.includes("인버스") || name.includes("곱버스");
  const longShort = name.includes("롱") && name.includes("숏");
  return { leveraged, inverse, derivative: tab === 3 || longShort || leveraged || inverse };
}

function safeType(name, tab, risky) {
  if (risky.leveraged || risky.inverse || risky.derivative) return null;
  const n = name.toUpperCase();
  if (/머니마켓|MMF|CD금리|KOFR|SOFR|초단기|단기통안/.test(name) || /\bCD\b/.test(n)) return "현금성";
  if (/혼합/.test(name)) return "채권혼합";
  if (tab === 6 || /채권|국고채|회사채|통안채|크레딧|국채/.test(name)) return "채권";
  if (/금현물|골드|GOLD/.test(n)) return "금";
  return null;
}

function exposureKey(name) {
  return name
    .replace(/^(KODEX|TIGER|RISE|PLUS|SOL|ACE|KIWOOM|KoAct|WON|HANARO|BNK|TIMEFOLIO|1Q|UNICORN|마이다스|파워)\s*/i, "")
    .replace(/\(합성[^)]*\)|\(H\)|액티브|TR\b|\s+/g, "")
    .toUpperCase();
}

function rankZ(values) {
  const n = values.length;
  if (n === 0) return [];
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const pct = new Array(n);
  order.forEach((e, r) => { pct[e.i] = (r + 1) / n; });
  const mean = pct.reduce((a, b) => a + b, 0) / n;
  return pct.map((p) => (p - mean) / RANK_Z_DENOM);
}

/** 최근 window 거래일 일수익률의 연환산 변동성(%) */
function annVolPct(closes, window = 60) {
  if (closes.length < 21) return null;
  const seg = closes.slice(-Math.min(window + 1, closes.length));
  const rets = [];
  for (let i = 1; i < seg.length; i++) if (seg[i - 1] > 0) rets.push(seg[i] / seg[i - 1] - 1);
  if (rets.length < 20) return null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length);
  const v = sd * Math.sqrt(252) * 100;
  return Number.isFinite(v) && v > 0 ? v : null;
}

async function fetchNaverEtfs() {
  const res = await fetch("https://finance.naver.com/api/sise/etfItemList.nhn", {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://finance.naver.com/sise/etf.naver" },
  });
  if (!res.ok) throw new Error(`네이버 목록 HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const json = JSON.parse(new TextDecoder("euc-kr").decode(buf));
  return (json?.result?.etfItemList ?? []).filter((i) => i?.itemcode && i?.itemname).map((it) => {
    const tab = Number(it.etfTabCode) || 7;
    const risky = classify(it.itemname, tab);
    return {
      ticker: String(it.itemcode).padStart(6, "0"),
      name: it.itemname.trim(),
      category: TAB[tab] ?? "기타",
      price: Number(it.nowVal) || 0,
      r3: Number(it.threeMonthEarnRate),
      marketCapEok: Number(it.marketSum) || 0,
      tradingMW: Number(it.amonut) || 0,
      ...risky,
      safeType: safeType(it.itemname, tab, risky),
    };
  });
}

/** Yahoo 일봉 종가 (6개월) */
async function fetchCloses(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.KS?range=6mo&interval=1d`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null;
    const j = await r.json();
    const q = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    const closes = (q ?? []).filter((v) => typeof v === "number" && v > 0);
    return closes.length ? closes : null;
  } catch { return null; }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) { const i = cursor++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/** 계좌별 추천 산출 — 앱의 getEtfRanking(dedup·demoteRisky 적용)과 동일 절차 */
async function buildPicks(all, account) {
  let pool = all.filter((e) => e.tradingMW >= MIN_TRADING_MW && e.marketCapEok >= MIN_MARKETCAP_EOK);
  if (account === "pension") pool = pool.filter((e) => !e.leveraged && !e.inverse && !e.derivative);
  pool = pool.filter((e) => Number.isFinite(e.r3));

  // 1) 모멘텀 정렬 → 중복 노출 제거
  pool.sort((a, b) => b.r3 - a.r3);
  const seen = new Set();
  pool = pool.filter((e) => {
    const k = exposureKey(e.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 2) 상위 후보만 변동성 산출 → 혼합 점수로 재정렬
  const cands = pool.slice(0, VOL_CANDIDATES);
  const vols = await mapLimit(cands, 6, async (e) => annVolPct((await fetchCloses(e.ticker)) ?? []));
  const withVol = cands.map((e, i) => ({ ...e, annVol: vols[i] })).filter((e) => e.annVol != null);

  if (withVol.length >= 5) {
    const mz = rankZ(withVol.map((e) => e.r3));
    const sz = rankZ(withVol.map((e) => e.r3 / Math.max(e.annVol, VOL_FLOOR_PCT)));
    withVol.forEach((e, i) => { e.blend = W_MOMENTUM * mz[i] + W_RISKADJ * sz[i]; });
    withVol.sort((a, b) => b.blend - a.blend);
  }

  // 3) 파생형 강등 (stock 탭에서만 의미 — pension은 이미 제외됨)
  const ordered = [
    ...withVol.filter((e) => !(e.leveraged || e.inverse || e.derivative)),
    ...withVol.filter((e) => e.leveraged || e.inverse || e.derivative),
  ];
  // 변동성 산출 실패로 재정렬에서 빠진 종목은 뒤에 붙여 후보 폭을 유지
  const rest = cands.filter((e) => !withVol.some((w) => w.ticker === e.ticker));
  return [...ordered, ...rest].slice(0, SAVE_LIMIT);
}

async function upsert(rows) {
  if (!rows.length) return;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/etf_pick_history?on_conflict=run_date,account,period,ticker`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) throw new Error(`upsert 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ── main ────────────────────────────────────────────────────────────────────
const runDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // KST 기준일
const PERIOD = "3M";

const all = await fetchNaverEtfs();
console.log(`[snapshot] ${runDate} | 전체 ${all.length}종목`);

let saved = 0;
for (const account of ["pension", "stock"]) {
  const picks = await buildPicks(all, account);
  const rows = picks.map((e, i) => ({
    run_date: runDate,
    account,
    period: PERIOD,
    rank: i < TOP_N ? i + 1 : null,
    ticker: e.ticker,
    name: e.name,
    category: e.category,
    price: e.price || null,
    sort_return: Number.isFinite(e.r3) ? e.r3 : null,
    ann_vol_pct: e.annVol ?? null,
    blend_score: e.blend ?? null,
    leveraged: !!e.leveraged,
    inverse: !!e.inverse,
    derivative: !!e.derivative,
    safe_type: e.safeType,
  }));
  await upsert(rows);
  saved += rows.length;
  console.log(`  ${account}: ${rows.length}행 (Top${TOP_N} rank 부여) — 1위 ${rows[0]?.name} ` +
    `${rows[0]?.sort_return?.toFixed(1)}% / 변동성 ${rows[0]?.ann_vol_pct?.toFixed(1) ?? "—"}%`);
}
console.log(`[snapshot] 완료: 총 ${saved}행 적재`);
