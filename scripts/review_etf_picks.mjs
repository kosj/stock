/**
 * review_etf_picks.mjs — ETF 추천 품질 점검 (실데이터 감사)
 * ============================================================================
 * 현재 추천 로직(3M 수익률 내림차순, 계좌별 편입 필터)이 실제로 "살 수 있는"
 * 종목을 추천하는지 실측 데이터로 점검한다. 점검 항목:
 *   1) 유동성  — 추천 상위에 거래대금·시총이 극히 낮은 ETF가 올라오는가
 *                (매수 시 스프레드·미체결 위험. 주식 추천 엔진에는 50억 필터가
 *                 있지만 ETF 랭킹에는 필터가 없다)
 *   2) 중복노출 — 상위권이 같은 지수를 추종하는 사실상 동일 상품으로 채워지는가
 *                (분산처럼 보이지만 실제로는 한 자산에 집중)
 *   3) 상품유형 — 일반 주식계좌 탭 상위에 레버리지·인버스가 얼마나 오는가
 */

const URL_ETF = "https://finance.naver.com/api/sise/etfItemList.nhn";
const TAB = { 1: "국내시장지수", 2: "국내업종테마", 3: "국내파생", 4: "해외주식", 5: "원자재", 6: "채권", 7: "기타" };

// 판정 임계 (앱의 주식 추천 유동성 필터 50억을 ETF 기준으로 참고)
const MIN_TRADING_VALUE_MW = 1000;  // 거래대금 10억원(=1000백만원) 미만이면 저유동
const MIN_MARKETCAP_EOK    = 500;   // 시총 500억원 미만이면 소형

function classify(name, tab) {
  const n = name.replace(/\s/g, "").toUpperCase();
  const leveraged = name.includes("레버리지") || n.includes("2X") || name.includes("2배");
  const inverse   = name.includes("인버스") || name.includes("곱버스");
  const longShort = name.includes("롱") && name.includes("숏");
  return { leveraged, inverse, derivative: tab === 3 || longShort || leveraged || inverse };
}

/** 상품명에서 브랜드 접두어를 떼어 "추종 대상"만 남긴다 — 중복 노출 판정용 */
function exposureKey(name) {
  return name
    .replace(/^(KODEX|TIGER|RISE|PLUS|SOL|ACE|KIWOOM|KoAct|WON|HANARO|BNK|TIMEFOLIO|1Q|UNICORN)\s*/i, "")
    .replace(/\(합성.*?\)|\(H\)|액티브|TR|\s/g, "")
    .toUpperCase();
}

const res = await fetch(URL_ETF, {
  headers: { "User-Agent": "Mozilla/5.0", Referer: "https://finance.naver.com/sise/etf.naver" },
});
const buf = await res.arrayBuffer();
const json = JSON.parse(new TextDecoder("euc-kr").decode(buf));
const items = json?.result?.etfItemList ?? [];

const etfs = items.filter((i) => i?.itemcode && i?.itemname).map((it) => {
  const tab = Number(it.etfTabCode) || 7;
  return {
    ticker: String(it.itemcode).padStart(6, "0"),
    name: it.itemname.trim(),
    category: TAB[tab] ?? "기타",
    r3: Number(it.threeMonthEarnRate),
    marketCapEok: Number(it.marketSum) || 0,
    tradingMW: Number(it.amonut) || 0,   // 거래대금(백만원)
    ...classify(it.itemname, tab),
  };
});

console.log(`[감사] 전체 ${etfs.length}종목 | 기준: 거래대금<${MIN_TRADING_VALUE_MW}백만원 저유동, 시총<${MIN_MARKETCAP_EOK}억 소형\n`);

function audit(label, pool) {
  const top = pool.filter((e) => Number.isFinite(e.r3)).sort((a, b) => b.r3 - a.r3).slice(0, 10);
  console.log(`── ${label} — 3M 상위 10 ─────────────────────────────`);
  let illiquid = 0, small = 0;
  for (const [i, e] of top.entries()) {
    const flags = [];
    if (e.tradingMW < MIN_TRADING_VALUE_MW) { flags.push("저유동"); illiquid++; }
    if (e.marketCapEok < MIN_MARKETCAP_EOK) { flags.push("소형"); small++; }
    if (e.leveraged) flags.push("레버리지");
    if (e.inverse) flags.push("인버스");
    console.log(
      `  ${String(i + 1).padStart(2)}. ${e.name.padEnd(30)} ${e.r3.toFixed(1).padStart(6)}%` +
      ` | 시총 ${String(Math.round(e.marketCapEok)).padStart(6)}억` +
      ` | 거래대금 ${String(Math.round(e.tradingMW)).padStart(6)}백만` +
      (flags.length ? `  ⚠ ${flags.join(",")}` : ""),
    );
  }
  // 중복 노출: 상위 10 중 같은 추종대상이 2개 이상인 그룹
  const byExp = {};
  for (const e of top) (byExp[exposureKey(e.name)] ??= []).push(e.name);
  const dups = Object.entries(byExp).filter(([, v]) => v.length > 1);
  console.log(`  → 저유동 ${illiquid}/10, 소형 ${small}/10, 중복노출 그룹 ${dups.length}개` +
    (dups.length ? `: ${dups.map(([k, v]) => `${k}(${v.length})`).join(", ")}` : ""));
  console.log("");
  return { illiquid, small, dups: dups.length };
}

const pension = etfs.filter((e) => !e.leveraged && !e.inverse && !e.derivative);
const a = audit("퇴직연금(DC·IRP) 편입가능", pension);
const b = audit("일반 주식계좌(제한 없음)", etfs);

// 유동성 필터를 적용하면 순위가 어떻게 바뀌는지 대조
const filtered = pension.filter((e) => e.tradingMW >= MIN_TRADING_VALUE_MW && e.marketCapEok >= MIN_MARKETCAP_EOK);
console.log(`── [대조] 연금 + 유동성 필터 적용 시 (${pension.length} → ${filtered.length}종목) ──`);
for (const [i, e] of filtered.sort((x, y) => y.r3 - x.r3).slice(0, 10).entries()) {
  console.log(`  ${String(i + 1).padStart(2)}. ${e.name.padEnd(30)} ${e.r3.toFixed(1).padStart(6)}%` +
    ` | 시총 ${String(Math.round(e.marketCapEok)).padStart(6)}억 | 거래대금 ${String(Math.round(e.tradingMW)).padStart(6)}백만`);
}

console.log(`\n[결론] 연금탭 저유동 ${a.illiquid}/10·중복 ${a.dups}개 | 주식탭 저유동 ${b.illiquid}/10·중복 ${b.dups}개`);
