/**
 * backtest_etf_picks.mjs — ETF 추천 실현성과 측정
 * ============================================================================
 * etf_pick_history(과거 추천) × 실현 수익률(Yahoo)을 결합해 ETF 추천이 실제로
 * 작동하는지 측정한다. 주식 추천 백테스트(backtest_recommendations.py)와 동일한
 * 방법론을 따른다:
 *   - 벤치마크는 날짜(asof) 기준 정렬 — 위치 인덱스 공유는 구간을 어긋나게 한다
 *   - 진입 시차 lag=1 (추천은 장중/마감 후 산출 → 다음 거래일 종가 진입)
 *   - 일별 IC 평균 + Newey-West t (중첩 라벨 자기상관 보정)
 *
 * 측정:
 *   [운영]   rank≤N 추천 포트폴리오의 실현 초과수익(vs KOSPI)
 *   [대조]   순수 모멘텀 상위 N (혼합 스코어 도입 효과 검증)
 *   [기준]   후보 유니버스 평균
 *
 * 사용: node scripts/backtest_etf_picks.mjs [--horizon 20] [--topn 10]
 * 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요");
  process.exit(1);
}

const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const HORIZON = argVal("--horizon", 20);   // 거래일
const TOPN    = argVal("--topn", 10);
const LAG     = argVal("--lag", 1);

// ── 통계 유틸 (metrics_util.py와 동일 정의) ────────────────────────────────
function neweyWestT(x, lag) {
  const v = x.filter(Number.isFinite);
  const n = v.length;
  if (n < 3) return NaN;
  const mu = v.reduce((a, b) => a + b, 0) / n;
  const e = v.map((a) => a - mu);
  let g = e.reduce((a, b) => a + b * b, 0) / n;
  const L = Math.min(Math.max(lag, 0), n - 1);
  for (let l = 1; l <= L; l++) {
    let cov = 0;
    for (let i = l; i < n; i++) cov += e[i] * e[i - l];
    cov /= n;
    g += 2 * (1 - l / (L + 1)) * cov;
  }
  return g > 0 ? mu / Math.sqrt(g / n) : NaN;
}

function spearman(a, b) {
  const rank = (v) => {
    const o = v.map((x, i) => ({ x, i })).sort((p, q) => p.x - q.x);
    const r = new Array(v.length);
    o.forEach((e, k) => { r[e.i] = k + 1; });
    return r;
  };
  const ra = rank(a), rb = rank(b), n = a.length;
  const ma = ra.reduce((x, y) => x + y, 0) / n, mb = rb.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : NaN;
}

// ── 데이터 조회 ─────────────────────────────────────────────────────────────
async function fetchHistory(account, period) {
  const url = `${SUPABASE_URL}/rest/v1/etf_pick_history` +
    `?select=run_date,rank,ticker,name,sort_return,blend_score,ann_vol_pct` +
    `&account=eq.${account}&period=eq.${period}&order=run_date.asc&limit=100000`;
  const r = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  if (!r.ok) throw new Error(`이력 조회 실패 ${r.status}`);
  return r.json();
}

/** Yahoo 일봉 → {dates:[YYYY-MM-DD], closes:[]} */
async function fetchSeries(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=2y&interval=1d`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null;
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const ts = res?.timestamp ?? [];
    const cl = res?.indicators?.quote?.[0]?.close ?? [];
    const dates = [], closes = [];
    for (let i = 0; i < ts.length; i++) {
      if (typeof cl[i] === "number" && cl[i] > 0) {
        dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10));
        closes.push(cl[i]);
      }
    }
    return dates.length ? { dates, closes } : null;
  } catch { return null; }
}

/** d0 이후 lag번째 거래일 진입 → horizon 거래일 뒤 청산. 벤치마크는 날짜 기준 정렬. */
function realizedAlpha(s, mkt, d0, horizon, lag) {
  const idx = s.dates.findIndex((d) => d >= d0);
  if (idx < 0) return null;
  const inI = idx + lag, outI = inI + horizon;
  if (outI >= s.dates.length) return null;
  const dIn = s.dates[inI], dOut = s.dates[outI];
  // 벤치마크: 해당 날짜 이하의 마지막 값(asof)
  const asof = (series, date) => {
    let v = null;
    for (let i = 0; i < series.dates.length; i++) {
      if (series.dates[i] <= date) v = series.closes[i]; else break;
    }
    return v;
  };
  const m0 = asof(mkt, dIn), m1 = asof(mkt, dOut);
  if (!m0 || !m1 || mkt.dates[mkt.dates.length - 1] < dOut) return null;
  return (s.closes[outI] / s.closes[inI] - 1) - (m1 / m0 - 1);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cur = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cur < items.length) { const i = cur++; out[i] = await fn(items[i]); }
  }));
  return out;
}

function stats(label, arr, horizon) {
  if (!arr.length) return console.log(`  ${label}: 측정 가능 표본 없음`);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const t = neweyWestT(arr, horizon);
  const hit = arr.filter((x) => x > 0).length / arr.length;
  console.log(`  ${label}: ${(mean * 100).toFixed(2)}% (NW t=${t.toFixed(2)}, Hit ${(hit * 100).toFixed(0)}%, ${arr.length}일)`);
  return mean;
}

// ── main ────────────────────────────────────────────────────────────────────
for (const account of ["pension", "stock"]) {
  const hist = await fetchHistory(account, "3M");
  if (!hist.length) {
    console.log(`\n[${account}] 추천 이력 없음 — 스냅샷 누적 후 재실행 (정상 종료)`);
    continue;
  }
  const runDates = [...new Set(hist.map((h) => h.run_date))].sort();
  const tickers = [...new Set(hist.map((h) => h.ticker))];
  console.log(`\n[${account}] 이력 ${hist.length}행 / ${runDates.length} run_date / ${tickers.length}종목 ` +
    `| h=${HORIZON} lag=${LAG} top${TOPN}`);

  const mkt = await fetchSeries("%5EKS11");
  if (!mkt) { console.log("  벤치마크(KOSPI) 조회 실패 — 건너뜀"); continue; }
  const seriesArr = await mapLimit(tickers, 6, (t) => fetchSeries(`${t}.KS`));
  const px = {};
  tickers.forEach((t, i) => { if (seriesArr[i]) px[t] = seriesArr[i]; });

  const prodA = [], pureA = [], uniA = [], icArr = [];
  for (const d0 of runDates) {
    const day = hist.filter((h) => h.run_date === d0);
    const rows = [];
    for (const h of day) {
      const s = px[h.ticker];
      if (!s) continue;
      const a = realizedAlpha(s, mkt, d0, HORIZON, LAG);
      if (a == null) continue;
      rows.push({ ...h, alpha: a });
    }
    if (rows.length < 5) continue;

    uniA.push(rows.reduce((x, r) => x + r.alpha, 0) / rows.length);

    // [운영] 저장된 rank ≤ TOPN (혼합 스코어 결과)
    const prod = rows.filter((r) => r.rank != null && r.rank <= TOPN);
    if (prod.length) prodA.push(prod.reduce((x, r) => x + r.alpha, 0) / prod.length);

    // [대조] 순수 모멘텀 상위 TOPN
    const pure = [...rows].sort((a, b) => (b.sort_return ?? -1e9) - (a.sort_return ?? -1e9)).slice(0, TOPN);
    if (pure.length) pureA.push(pure.reduce((x, r) => x + r.alpha, 0) / pure.length);

    // IC: 혼합 점수(없으면 수익률) 순위 vs 실현 알파 순위
    const scored = rows.filter((r) => r.blend_score != null || r.sort_return != null);
    if (scored.length >= 5) {
      const ic = spearman(scored.map((r) => r.blend_score ?? r.sort_return), scored.map((r) => r.alpha));
      if (Number.isFinite(ic)) icArr.push(ic);
    }
  }

  if (!uniA.length) { console.log("  호라이즌 경과한 run_date 부족 — 누적 대기"); continue; }
  const icMean = icArr.reduce((a, b) => a + b, 0) / (icArr.length || 1);
  console.log(`  실현 IC 평균: ${icMean.toFixed(4)} (NW t=${neweyWestT(icArr, HORIZON).toFixed(2)}, ${icArr.length}일) ← |t|≥2 라야 유의`);
  const uni = stats("[기준] 유니버스 평균", uniA, HORIZON);
  const prod = stats(`[운영] 혼합 top${TOPN}`, prodA, HORIZON);
  const pure = stats(`[대조] 순수모멘텀 top${TOPN}`, pureA, HORIZON);
  if (prod != null && uni != null) console.log(`  → 초과수익(vs 유니버스): ${((prod - uni) * 100).toFixed(2)}%p`);
  if (prod != null && pure != null) console.log(`  → 혼합 vs 순수모멘텀: ${((prod - pure) * 100).toFixed(2)}%p`);
}
console.log("\n완료");
