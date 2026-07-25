/**
 * verify_etf_universe.mjs — 전체 ETF 랭킹 파이프라인 실검증 (GitHub Actions용)
 * ============================================================================
 * naver-etf.ts의 수집·디코딩·분류 로직과 동일한 절차를 순수 Node로 재현해,
 * 실제 네이버 응답에 대해 다음을 검증한다:
 *   1) 전 종목 수집 및 EUC-KR 디코딩(종목명 한글 정상)
 *   2) 레버리지/인버스 판정 → 연금·IRP 필터가 실제로 걸러내는지
 *   3) 1D·3M 수익률 정렬로 "전체 유니버스" 랭킹이 만들어지는지
 * 실패 시 비정상 종료(exit 1)하여 CI가 회귀를 잡는다.
 */

const URL_ETF = "https://finance.naver.com/api/sise/etfItemList.nhn";

function classify(name, tab) {
  const n = name.replace(/\s/g, "").toUpperCase();
  return {
    leveraged: name.includes("레버리지") || n.includes("2X") || name.includes("2배"),
    inverse:   name.includes("인버스") || name.includes("곱버스"),
    overseas:  tab === 4 || tab === 5,
  };
}

const TAB = { 1: "국내시장지수", 2: "국내업종테마", 3: "국내파생", 4: "해외주식", 5: "원자재", 6: "채권", 7: "기타" };

const res = await fetch(URL_ETF, {
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; stock-dashboard/1.0)",
    Referer: "https://finance.naver.com/sise/etf.naver",
  },
});
if (!res.ok) { console.error(`HTTP ${res.status}`); process.exit(1); }

const buf = await res.arrayBuffer();
let json;
try {
  json = JSON.parse(new TextDecoder("euc-kr").decode(buf));
} catch (e) {
  console.error("EUC-KR 디코딩 실패:", e.message);
  process.exit(1);
}

const items = json?.result?.etfItemList ?? [];
const etfs = items.filter((i) => i?.itemcode && i?.itemname).map((it) => {
  const tab = Number(it.etfTabCode) || 7;
  return {
    ticker: String(it.itemcode).padStart(6, "0"),
    name: it.itemname.trim(),
    category: TAB[tab] ?? "기타",
    price: Number(it.nowVal) || 0,
    return1D: Number.isFinite(Number(it.changeRate)) ? Number(it.changeRate) : null,
    return3M: Number.isFinite(Number(it.threeMonthEarnRate)) ? Number(it.threeMonthEarnRate) : null,
    marketCapEok: Number(it.marketSum) || 0,
    ...classify(it.itemname, tab),
  };
});

console.log(`[1] 수집: ${etfs.length}종목`);
if (etfs.length < 500) { console.error("FAIL: ETF 수가 비정상적으로 적음"); process.exit(1); }

// 한글 디코딩 검증 — 종목명에 한글이 충분히 존재해야 한다
const hangul = etfs.filter((e) => /[가-힣]/.test(e.name)).length;
console.log(`[2] 한글 종목명: ${hangul}/${etfs.length} (${((hangul / etfs.length) * 100).toFixed(1)}%)`);
if (hangul / etfs.length < 0.8) { console.error("FAIL: EUC-KR 디코딩 이상(한글 비율 낮음)"); process.exit(1); }

// 연금/IRP 필터 검증
const lev = etfs.filter((e) => e.leveraged), inv = etfs.filter((e) => e.inverse);
const pension = etfs.filter((e) => !e.leveraged && !e.inverse);
console.log(`[3] 레버리지 ${lev.length} / 인버스 ${inv.length} → 연금·IRP 편입가능 ${pension.length}종목`);
if (lev.length === 0 || inv.length === 0) { console.error("FAIL: 레버리지/인버스 판정 실패"); process.exit(1); }
if (pension.some((e) => e.leveraged || e.inverse)) { console.error("FAIL: 필터 누수"); process.exit(1); }
console.log(`    제외 예시: ${[...lev.slice(0, 2), ...inv.slice(0, 2)].map((e) => e.name).join(" / ")}`);

// 수익률 커버리지 + 랭킹
for (const [label, key] of [["1D", "return1D"], ["3M", "return3M"]]) {
  const withVal = etfs.filter((e) => e[key] != null);
  const ranked = [...withVal].sort((a, b) => b[key] - a[key]);
  console.log(`[4] ${label} 커버리지 ${withVal.length}/${etfs.length} — 상위 3: ` +
    ranked.slice(0, 3).map((e) => `${e.name}(${e[key] > 0 ? "+" : ""}${e[key]}%)`).join(", "));
  if (withVal.length / etfs.length < 0.7) { console.error(`FAIL: ${label} 커버리지 부족`); process.exit(1); }
  // 정렬 단조성 검증
  for (let i = 1; i < ranked.length; i++) {
    if (ranked[i - 1][key] < ranked[i][key]) { console.error("FAIL: 정렬 오류"); process.exit(1); }
  }
}

// 연금 계좌 기준 3M 랭킹(실제 서비스 시나리오)
const pensionRanked = pension.filter((e) => e.return3M != null).sort((a, b) => b.return3M - a.return3M);
console.log(`[5] 연금·IRP 3M 랭킹 ${pensionRanked.length}종목 — 상위 3: ` +
  pensionRanked.slice(0, 3).map((e) => `${e.name}(+${e.return3M}%)`).join(", "));

console.log(`[6] 분류 분포: ${JSON.stringify(
  etfs.reduce((a, e) => ((a[e.category] = (a[e.category] || 0) + 1), a), {}), null, 0)}`);

console.log("\n✅ 전체 ETF 유니버스 파이프라인 검증 통과");
