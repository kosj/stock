/**
 * 뉴스 선별 로직 자체검증 — 임계값 보정용.
 * 실행: node --experimental-strip-types scripts/test_news_curation.mts
 *
 * 중복 판정은 임계값 하나로 국문/영문을 모두 다루므로, 실제로 같은 사건인
 * 제목쌍과 다른 사건인 제목쌍을 모두 넣어 양방향으로 확인한다.
 * (한쪽만 보면 임계값을 낮춰 전부 병합하거나 높여 전부 통과시키게 된다)
 */
import { tokenize, similarity, containment, isSameStory, keyOf, curate } from "../frontend/lib/server/news-curation.ts";
import type { NewsItem } from "../frontend/lib/server/news-feeds.ts";

let fail = 0;
const pass = (ok: boolean, label: string, extra = "") => {
  if (!ok) fail++;
  console.log(`  ${ok ? "OK " : "NG "} ${label}${extra ? "  " + extra : ""}`);
};

// ── 같은 사건 (병합돼야 함) ────────────────────────────────────────────────
const SAME: [string, string][] = [
  ["코스피, 사흘 만에 반등…외국인 순매수 전환", "코스피 사흘 만에 반등 마감…외국인 순매수"],
  ["한국은행 기준금리 연 2.50% 동결", "한은, 기준금리 2.50%로 동결…성장률 전망 유지"],
  ["삼성전자 3분기 영업이익 12조원…시장 전망 상회", "삼성전자, 3분기 영업이익 12조 기록…컨센서스 상회"],
  ["Fed holds rates steady as inflation cools", "Federal Reserve holds interest rates steady amid cooling inflation"],
  ["Nvidia shares jump on strong AI chip demand", "Nvidia stock jumps as AI chip demand stays strong"],
];

// ── 다른 사건 (병합되면 안 됨) ─────────────────────────────────────────────
const DIFF: [string, string][] = [
  ["삼성전자, 3분기 영업이익 12조원", "SK하이닉스, HBM 증설 투자 확대"],
  ["코스피 사흘 만에 반등", "코스닥 나흘째 하락…개인 매도"],
  ["한은 기준금리 동결", "정부, 부동산 대책 발표"],
  ["Fed holds rates steady", "Oil prices slide on OPEC output plan"],
  ["Nvidia shares jump on AI demand", "Tesla recalls 200,000 vehicles over software fault"],
];

console.log("[중복 유사도]");
const metrics = (a: string, b: string) => {
  const [ta, tb] = [tokenize(a), tokenize(b)];
  return `sim=${similarity(ta, tb).toFixed(2)} cont=${containment(ta, tb).toFixed(2)}`;
};
for (const [a, b] of SAME) {
  pass(isSameStory(keyOf(a), keyOf(b)), `같은 사건 병합: ${a.slice(0, 22)}…`, metrics(a, b));
}
for (const [a, b] of DIFF) {
  pass(!isSameStory(keyOf(a), keyOf(b)), `다른 사건 유지: ${a.slice(0, 22)}…`, metrics(a, b));
}

// ── 정형 게시물 제외 ───────────────────────────────────────────────────────
const mk = (title: string, outlet = "연합뉴스", minsAgo = 30): NewsItem => ({
  id: `x:${title}`, title, link: `https://e.com/${encodeURIComponent(title)}`,
  publishedAt: new Date(Date.now() - minsAgo * 60000).toISOString(),
  outlet, sourceId: "s", region: "domestic", summary: "",
});

const NOISE = [
  "[사진]KT,'상처만 남은 광주 원정'",
  "[표] 코스피 주요 종목 시세",
  "[부고] 홍길동 씨 부친상",
  "[인사] 금융위원회",
  "[게시판] 신한은행, 사회공헌 행사",
  "I'm 64 and my husband is 70. Should we take Social Security now?",
  "We're in our 60s. We earn $345,000 and have $1 million in 403(b) plans.",
  "My wife wants to sell our house. Am I entitled to half?",
];
const REAL = [
  "[속보] 한국은행 기준금리 동결",
  "[단독] 정부, 반도체 특별법 추진",
  "코스피 3200 돌파…외국인 순매수",
  "Fed signals rate cut as inflation cools",
];
console.log("\n[정형 게시물 제외]");
{
  const r = curate([...NOISE, ...REAL].map((t) => mk(t)));
  const droppedTitles = new Set(r.dropped.map((d) => d.title));
  for (const t of NOISE) pass(droppedTitles.has(t), `제외: ${t.slice(0, 34)}…`);
  for (const t of REAL) pass(!droppedTitles.has(t), `유지: ${t.slice(0, 34)}…`);
}

// ── 중복 병합 후 대표 1건 + 매체 수 ────────────────────────────────────────
console.log("\n[병합 결과]");
{
  const items = [
    mk("코스피, 사흘 만에 반등…외국인 순매수 전환", "연합뉴스", 10),
    mk("코스피 사흘 만에 반등 마감…외국인 순매수", "매일경제", 20),
    mk("코스피 사흘만에 반등…외국인이 순매수", "한국경제", 25),
    mk("SK하이닉스, HBM 증설 투자 확대", "뉴시스", 15),
  ];
  const r = curate(items);
  const kospi = r.all.find((i) => i.title.includes("코스피"));
  pass(r.all.length === 2, `4건 → 대표 2건`, `실제 ${r.all.length}`);
  pass(kospi?.dupCount === 2, `코스피 중복 2건 병합`, `dupCount=${kospi?.dupCount}`);
  pass(
    (kospi?.dupOutlets ?? []).sort().join(",") === "매일경제,한국경제",
    `보도 매체 기록`, `[${kospi?.dupOutlets.join(", ")}]`,
  );
}

// ── 주요 목록: 비지 않고, 시간 역순 정렬 ───────────────────────────────────
console.log("\n[주요 목록]");
{
  const many: NewsItem[] = [];
  // 서로 다른 기사여야 한다. 비슷한 문장에 번호만 바꾸면 중복 병합으로
  // 전부 한 건이 돼 최소 개수 검증이 무의미해진다(첫 작성 시 실제로 그랬다).
  const SUBJECTS = ["현대차","기아","네이버","카카오","셀트리온","포스코","한화","두산","LG전자","아모레퍼시픽",
                    "CJ대한통운","이마트","현대건설","대한항공","하나투어","넥슨","크래프톤","엔씨","농심","오뚜기",
                    "빙그레","롯데칠성","한샘","코웨이","쿠팡","무신사","야놀자","토스","당근","배민"];
  const ACTIONS = ["신공장 착공", "해외 법인 설립", "브랜드 리뉴얼", "물류센터 확장", "사옥 이전"];
  let n = 0;
  for (const subj of SUBJECTS) {
    for (const act of ACTIONS) {
      if (n >= 80) break;
      many.push(mk(`${subj}, ${act}`, "뉴시스", (n + 1) * 20));
      n++;
    }
  }
  many.push(mk("[속보] 한은, 기준금리 인하…3년 만", "연합뉴스", 5));
  const r = curate(many);
  pass(r.major.length >= 24, `최소 개수 확보`, `${r.major.length}건`);
  pass(r.major.length <= 60, `상한 준수`, `${r.major.length}건`);
  const times = r.major.map((i) => new Date(i.publishedAt!).getTime());
  pass(times.every((t, i) => i === 0 || times[i - 1] >= t), "시간 역순 정렬");
  pass(r.major.some((i) => i.title.includes("[속보]")), "속보는 주요에 포함");
}

// ── 정치 기사 감점 ─────────────────────────────────────────────────────────
// 시장 신호가 없는 정쟁 기사는 여러 매체가 써도 내려가야 하고,
// 시장·정책이 얽힌 정치 기사는 남아야 한다.
console.log("\n[정치 기사 감점]");
{
  const politicsOnly = [
    mk('주진우 "김승원 자녀, 아내 원장인 기관 취업"…金측 "가족폄훼"(종합2보)', "연합뉴스", 10),
    mk('주진우 "김승원 자녀 기관 취업 특혜"…민주당 "가족폄훼 중단하라"', "매일경제", 15),
    mk('국민의힘, 김승원 낙마 공세…의혹 제기 이어져', "한국경제", 20),
  ];
  const marketPolitics = [
    mk("국회, 반도체특별법 본회의 통과…설비투자 세액공제 확대", "연합뉴스", 12),
    mk("정부, 관세 인상 대응책 발표…수출기업 금융지원 확대", "매일경제", 18),
  ];
  const filler = Array.from({ length: 30 }, (_, i) =>
    mk(`${["현대차","네이버","포스코","한화","셀트리온","카카오"][i % 6]}, ${["신공장 착공","해외 법인 설립","브랜드 리뉴얼","물류센터 확장","사옥 이전"][i % 5]} ${i}`, "뉴시스", 40 + i * 15));

  const r = curate([...politicsOnly, ...marketPolitics, ...filler]);
  const inMajor = (frag: string) => r.major.some((i) => i.title.includes(frag));
  const scoreOfTitle = (frag: string) => r.all.find((i) => i.title.includes(frag))?.score;

  pass(!inMajor("김승원"), "정쟁 기사는 주요에서 제외", `score=${scoreOfTitle("김승원")}`);
  pass(inMajor("반도체특별법"), "시장 얽힌 정치는 유지", `score=${scoreOfTitle("반도체특별법")}`);
  pass(inMajor("관세 인상"), "정책·관세 기사는 유지", `score=${scoreOfTitle("관세 인상")}`);
}

// ── 과도하게 넓은 키워드 회귀 ──────────────────────────────────────────────
// "기관"만으로 시장 가점을 주면 "기관 취업" 같은 표현이 걸린다(실측 사고).
console.log("\n[키워드 과매칭 회귀]");
{
  const r = curate([
    mk("아내가 원장인 기관 취업 논란", "연합뉴스", 5),
    mk("외국인 노동자 고용 허가 확대", "뉴시스", 6),
    mk("코스피, 기관 순매수에 반등", "매일경제", 7),
    mk("외국인 순매수 이어져…환율 안정", "한국경제", 8),
  ]);
  const sc = (frag: string) => r.all.find((i) => i.title.includes(frag))?.score ?? 0;
  pass(sc("기관 취업") < sc("기관 순매수"), "'기관 취업' < '기관 순매수'", `${sc("기관 취업")} vs ${sc("기관 순매수")}`);
  pass(sc("외국인 노동자") < sc("외국인 순매수"), "'외국인 노동자' < '외국인 순매수'", `${sc("외국인 노동자")} vs ${sc("외국인 순매수")}`);
}

// ── 상투구 오병합 회귀 ─────────────────────────────────────────────────────
// 회사명만 다르고 나머지가 같은 제목들. 중복 제거가 서로 다른 회사 기사를
// 삼키면 안 된다 — 가장 위험한 실패다.
console.log("\n[상투구 오병합 회귀]");
{
  const items = [
    mk("삼성전자, 3분기 영업이익 12조원 기록", "연합뉴스", 10),
    mk("LG전자, 3분기 영업이익 1조원 기록", "매일경제", 12),
    mk("SK하이닉스, 3분기 영업이익 9조원 기록", "한국경제", 14),
    mk("현대차, 신공장 착공", "뉴시스", 16),
    mk("기아, 신공장 착공", "뉴시스", 18),
    mk("포스코, 신공장 착공", "아시아경제", 20),
  ];
  const r = curate(items);
  pass(r.all.length === items.length,
       "서로 다른 회사 기사는 각각 유지", `${items.length}건 → ${r.all.length}건`);
  const merged = r.all.filter((i) => i.dupCount > 0).map((i) => i.title.slice(0, 20));
  pass(merged.length === 0, "잘못된 병합 없음", merged.join(" / ") || "-");
}

console.log(`\n${fail === 0 ? "전체 통과" : `${fail}건 실패`}`);
process.exit(fail === 0 ? 0 : 1);
