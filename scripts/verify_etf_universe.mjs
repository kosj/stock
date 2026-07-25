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
  const leveraged = name.includes("레버리지") || n.includes("2X") || name.includes("2배");
  const inverse   = name.includes("인버스") || name.includes("곱버스");
  const longShort = name.includes("롱") && name.includes("숏");
  return {
    leveraged,
    inverse,
    derivative: tab === 3 || longShort || leveraged || inverse,
    overseas:   tab === 4 || tab === 5,
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

// 연금/IRP 필터 검증 — 레버리지·인버스뿐 아니라 파생형(롱숏/국내파생)도 제외돼야 한다
const lev = etfs.filter((e) => e.leveraged), inv = etfs.filter((e) => e.inverse);
const der = etfs.filter((e) => e.derivative);
const pension = etfs.filter((e) => !e.leveraged && !e.inverse && !e.derivative);
console.log(`[3] 레버리지 ${lev.length} / 인버스 ${inv.length} / 파생형 ${der.length}`
  + ` → 연금·IRP 편입가능 ${pension.length}종목`);
if (lev.length === 0 || inv.length === 0) { console.error("FAIL: 레버리지/인버스 판정 실패"); process.exit(1); }
if (pension.some((e) => e.leveraged || e.inverse || e.derivative)) {
  console.error("FAIL: 필터 누수"); process.exit(1);
}
// 회귀 방지: 롱숏 파생형이 연금 목록에 절대 남아서는 안 된다
const leaked = pension.filter((e) => (e.name.includes("롱") && e.name.includes("숏")));
if (leaked.length > 0) {
  console.error(`FAIL: 롱숏 파생형이 연금 편입가능에 포함됨 — ${leaked.slice(0, 3).map((e) => e.name).join(", ")}`);
  process.exit(1);
}
console.log(`    제외 예시: ${[...lev.slice(0, 1), ...inv.slice(0, 1),
  ...der.filter((e) => !e.leveraged && !e.inverse).slice(0, 2)].map((e) => e.name).join(" / ")}`);

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

// 연금 계좌 기준 3M 랭킹(실제 서비스 시나리오) — 상위 종목이 실제로 담을 수 있는지 확인
const pensionRanked = pension.filter((e) => e.return3M != null).sort((a, b) => b.return3M - a.return3M);
console.log(`[5] 연금·IRP 3M 랭킹 ${pensionRanked.length}종목 — 상위 5:`);
for (const e of pensionRanked.slice(0, 5)) {
  console.log(`      ${e.name} (${e.category}) +${e.return3M}%`);
}

console.log(`[6] 분류 분포: ${JSON.stringify(
  etfs.reduce((a, e) => ((a[e.category] = (a[e.category] || 0) + 1), a), {}), null, 0)}`);

// ── 안전자산 분류 검증 (naver-etf.ts classifySafeAsset과 동일 규칙) ─────────
function classifySafe(name, tab, risky) {
  if (risky.leveraged || risky.inverse || risky.derivative) return null;
  const n = name.toUpperCase();
  if (/머니마켓|MMF|CD금리|CD 금리|KOFR|SOFR|초단기|단기통안|머니풀/.test(name) || /\bCD\b/.test(n)) return "현금성";
  if (tab === 6 || /채권|국고채|회사채|통안채|크레딧|국채/.test(name)) return "채권";
  if (/금현물|골드|GOLD/.test(n) || /금\s*선물/.test(name)) return "금";
  return null;
}
const safe = [];
for (const it of items) {
  const tab = Number(it.etfTabCode) || 7;
  const risky = classify(it.itemname, tab);
  const t = classifySafe(it.itemname.trim(), tab, risky);
  if (t) safe.push({ name: it.itemname.trim(), type: t, r3: Number(it.threeMonthEarnRate) });
}
const byType = safe.reduce((a, e) => ((a[e.type] = (a[e.type] || 0) + 1), a), {});
console.log(`[7] 안전자산 ${safe.length}종목 — ${JSON.stringify(byType)}`);
if (safe.length < 100) { console.error("FAIL: 안전자산 분류가 비정상적으로 적음"); process.exit(1); }
// 안전자산에 레버리지·인버스·파생형이 섞이면 안 된다
const badSafe = safe.filter((e) => /레버리지|인버스|곱버스/.test(e.name));
if (badSafe.length > 0) {
  console.error(`FAIL: 안전자산에 파생형 혼입 — ${badSafe.slice(0, 3).map((e) => e.name).join(", ")}`);
  process.exit(1);
}
const safeRanked = safe.filter((e) => Number.isFinite(e.r3)).sort((a, b) => b.r3 - a.r3);
console.log(`    3M 상위 3: ${safeRanked.slice(0, 3).map((e) => `${e.name}[${e.type}](${e.r3.toFixed(2)}%)`).join(", ")}`);
console.log(`    3M 하위 1: ${safeRanked.slice(-1).map((e) => `${e.name}[${e.type}](${e.r3.toFixed(2)}%)`).join("")}`);

console.log("\n✅ 전체 ETF 유니버스 파이프라인 검증 통과");
