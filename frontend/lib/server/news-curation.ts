/**
 * 뉴스 선별 — 중복 병합 + 중요도 판정
 * ============================================================================
 * 수집한 원본 목록을 그대로 보여주면 두 가지가 섞인다.
 *   1) 같은 사건을 여러 매체가 보도한 중복 (연합/매경/한경이 같은 발표를 각각 씀)
 *   2) 뉴스가 아닌 정형 게시물 — [사진]·[표]·[부고]·[인사], 개인 재무상담 칼럼 등
 *
 * 원칙
 *   - 지우는 기준을 코드에 드러낸다. "어쩐지 덜 중요해 보여서"로 지우지 않는다.
 *   - 중복은 삭제가 아니라 병합이다. 대표 기사 한 건만 남기되 몇 개 매체가
 *     보도했는지 남긴다 — 그 자체가 사안 크기의 신호다.
 *   - 키워드 미포함이라고 버리지 않는다. 점수로 정렬해 상위를 취하는 방식이라
 *     새로운 주제도 매체 수·속보 여부로 올라올 수 있다.
 */

import type { NewsItem } from "./news-feeds";

export interface CuratedItem extends NewsItem {
  /** 같은 사건을 보도한 다른 기사 수(대표 1건 제외) */
  dupCount: number;
  /** 대표 기사 외 보도 매체명 */
  dupOutlets: string[];
  score: number;
}

export interface DroppedItem {
  title: string;
  outlet: string;
  reason: string;
}

export interface CurationResult {
  /** 중복 병합 후 중요도 상위 — 화면 기본 목록 */
  major: CuratedItem[];
  /** 중복 병합만 적용한 전체 */
  all: CuratedItem[];
  /** 뉴스가 아니라고 판단해 제외한 항목 */
  dropped: DroppedItem[];
}

// ── 1) 뉴스가 아닌 정형 게시물 ──────────────────────────────────────────────
// 통신사·경제지가 정기적으로 올리는 비기사 게시물. 제목 형식이 고정돼 있어
// 패턴으로 확실히 걸러진다. 애매한 것(사설·칼럼·인터뷰)은 여기 넣지 않는다.
const NOISE_KO = /(^|\s)\[(사진|포토|표|부고|인사|동정|게시판|알림|공고|모집|안내|정정|오늘의 운세|운세|날씨|주요 일정|일정)\]/;
const NOISE_KO_TAIL = /(부고|인사|동정)\s*[:：]/;

// 영미 경제지의 개인 재무상담·라이프스타일 칼럼. 1인칭으로 시작하는 제목은
// 사실상 전부 상담 칼럼이다(MarketWatch The Moneyist 계열).
//   예: "I'm 64 and my husband is 70. Should we…"
//       "We're in our 60s. We earn $345,000 and have $1 million in 403(b)…"
const NOISE_EN_FIRST_PERSON = /^["'‘“]?(i['’]m|i am|i["’]ve|i have|i["’]ll|i |we['’]re|we are|we["’]ve|we |my |our |dear )/i;
const NOISE_EN_ADVICE = /\b(moneyist|horoscope|recipe|best deals?|shopping guide|gift guide)\b/i;

function noiseReason(item: NewsItem): string | null {
  const t = item.title;
  if (NOISE_KO.test(t) || NOISE_KO_TAIL.test(t)) return "정형 게시물(사진·표·부고·인사 등)";
  if (NOISE_EN_FIRST_PERSON.test(t)) return "개인 재무상담 칼럼(1인칭 제목)";
  if (NOISE_EN_ADVICE.test(t)) return "상담·쇼핑·라이프스타일 칼럼";
  return null;
}

// ── 2) 중복 판정 ────────────────────────────────────────────────────────────
// 제목을 정규화해 토큰 집합으로 만들고 자카드 유사도를 본다.
// 한글은 형태소 분석기 없이 다루므로 공백 제거 후 문자 바이그램을 쓴다.
// 영문은 3자 이상 단어. 숫자는 그대로 토큰으로 둔다 — "3200", "0.25%" 같은
// 수치가 같은 사건을 가리키는 가장 강한 신호다.
const BRACKET = /[[(【〔<][^\])】〕>]{0,12}[\])】〕>]/g;      // [단독] (종합) 등 말머리
const PUNCT = /[^\p{L}\p{N}%]+/gu;
const EN_STOP = new Set([
  "the","a","an","and","or","but","for","of","to","in","on","at","by","with",
  "from","as","is","are","was","were","be","been","that","this","it","its",
  "after","before","over","into","says","said","new","how","why","what",
]);

/**
 * 기관·지수명 약어 통일.
 * 한글 제목은 문자 바이그램으로 비교하는데, 같은 사건을 다룬 두 기사가
 * "한국은행"과 "한은"을 각각 쓰면 겹치는 바이그램이 통째로 사라져 유사도가
 * 절반 아래로 떨어진다(실측: 0.25). 금융 기사에서 반복되는 약어는 수가
 * 많지 않으므로 정식명칭을 약칭으로 모아 준다.
 * 형태소 분석기를 붙이는 대신 택한 방법이라, 목록에 없는 약어는 여전히
 * 놓친다 — 새 사례가 보이면 여기 추가한다.
 */
const ABBREV: [RegExp, string][] = [
  [/한국은행/g, "한은"],
  [/금융감독원/g, "금감원"],
  [/금융위원회/g, "금융위"],
  [/공정거래위원회/g, "공정위"],
  [/기획재정부/g, "기재부"],
  [/국토교통부/g, "국토부"],
  [/산업통상자원부/g, "산업부"],
  [/중소벤처기업부/g, "중기부"],
  [/(미국 ?)?연방준비제도(이사회)?/g, "연준"],
  [/국민연금공단/g, "국민연금"],
  [/한국거래소/g, "거래소"],
  [/코스피지수/g, "코스피"],
  [/코스닥지수/g, "코스닥"],
];

function normalize(title: string): string {
  let t = title.replace(BRACKET, " ");
  for (const [re, to] of ABBREV) t = t.replace(re, to);
  return t.replace(PUNCT, " ").trim().toLowerCase();
}

/**
 * 경량 스테밍. 같은 사건을 다룬 영문 제목은 굴절만 다른 경우가 많다
 * (holds/hold, cools/cooling, jumps/jumping). 형태소 분석기 없이 접미사만
 * 떼되, 짧은 단어는 건드리지 않아 과도한 병합을 막는다.
 */
function stem(w: string): string {
  if (w.length > 6 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokenize(title: string): Set<string> {
  const norm = normalize(title);
  const out = new Set<string>();

  // 영문 단어 + 숫자
  for (const w of norm.split(/\s+/)) {
    if (!w) continue;
    if (/^[0-9]/.test(w)) { out.add(w); continue; }         // 수치는 길이 무관
    if (/[ㄱ-힝一-鿿]/.test(w)) continue;   // 한글·한자는 아래에서
    if (w.length >= 3 && !EN_STOP.has(w)) out.add(stem(w));
  }

  // 한글·한자 문자 바이그램 (공백 제거 후)
  const cjk = norm.replace(/[^ㄱ-힝一-鿿0-9]/g, "");
  for (let i = 0; i + 1 < cjk.length; i++) out.add(cjk.slice(i, i + 2));

  return out;
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (large.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * 포함계수 — 짧은 쪽이 긴 쪽에 얼마나 담겨 있는가.
 * "한국은행 기준금리 연 2.50% 동결" vs "한은, 기준금리 2.50%로 동결…성장률
 * 전망 유지" 처럼 한쪽에만 절이 더 붙은 쌍은 자카드가 길이 차로 깎여
 * (0.25) 놓치지만 포함계수는 0.5를 넘는다.
 * 다만 짧은 제목이 아무 긴 제목에나 삼켜질 수 있어 토큰 수 하한을 둔다.
 */
export function containment(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size < 8) return 0;          // 너무 짧으면 판단 근거가 부족하다
  let inter = 0;
  for (const t of small) if (large.has(t)) inter++;
  return inter / small.size;
}

/** 두 제목이 같은 사건인지 — 자카드 또는 포함계수 중 하나라도 넘으면 같다 */
export function isSameStory(a: Set<string>, b: Set<string>): boolean {
  return similarity(a, b) >= DUP_MIN_SIM || containment(a, b) >= DUP_MIN_CONTAIN;
}

/** 같은 사건으로 볼 유사도 하한. 아래 테스트(scripts/test_news_curation.mjs)로 보정. */
const DUP_MIN_SIM = 0.42;
/** 포함계수 하한(자카드가 길이 차로 깎이는 쌍을 구제) */
const DUP_MIN_CONTAIN = 0.55;
/** 같은 사건이라면 발행 간격이 이 이내다. 재발 헤드라인의 오병합을 막는다. */
const DUP_MAX_GAP_MS = 18 * 60 * 60 * 1000;

// ── 3) 중요도 ───────────────────────────────────────────────────────────────
// 키워드는 "이게 없으면 버린다"가 아니라 가점 신호다. 매체 수·속보 가점만으로도
// 상위에 오를 수 있어 키워드 밖의 새 주제가 묻히지 않는다.
const KEY_MACRO = /(금리|기준금리|인플레|물가|소비자물가|CPI|연준|美 ?연준|FOMC|환율|원\/달러|관세|무역|수출|수입|GDP|성장률|고용|실업|경기|재정|국채|유가|달러|엔화|위안|federal reserve|inflation|interest rate|tariff|trade war|jobs report|payrolls|treasury|yield|gdp|recession|central bank)/i;
const KEY_MARKET = /(코스피|코스닥|증시|주가|나스닥|다우|S&P|선물|공매도|외국인|기관|시가총액|상장|IPO|배당|자사주|어닝|실적|영업이익|매출|인수|합병|M&A|파산|감산|증산|반도체|배터리|AI|stocks?|market|nasdaq|dow|s&p|earnings|revenue|merger|acquisition|ipo|bankrupt|chip|semiconductor)/i;
const KEY_BREAKING = /(\[속보\]|\[단독\]|^속보|breaking|exclusive)/i;
const KEY_POLICY = /(정부|당국|금감원|금융위|한은|한국은행|국회|규제|제재|조사|과징금|기소|압수수색|regulator|sec |doj |antitrust|sanction|lawsuit|probe)/i;

function scoreOf(item: CuratedItem): number {
  const t = `${item.title} ${item.summary}`;
  let s = 0;
  if (KEY_MACRO.test(t)) s += 3;
  if (KEY_MARKET.test(t)) s += 2;
  if (KEY_POLICY.test(t)) s += 2;
  if (KEY_BREAKING.test(item.title)) s += 3;
  // 여러 매체가 동시에 쓴 사안은 그 자체로 크다. 과대 가중은 막는다.
  s += Math.min(item.dupCount, 4) * 2;
  // 신선도 — 같은 점수면 최근 것을 위로
  if (item.publishedAt) {
    const ageH = (Date.now() - new Date(item.publishedAt).getTime()) / 3_600_000;
    if (ageH <= 3) s += 2;
    else if (ageH <= 12) s += 1;
    else if (ageH > 48) s -= 2;
  } else {
    s -= 1;                       // 시각 미상은 신뢰도가 낮다
  }
  return s;
}

/** 주요 목록 하한 점수 */
const MAJOR_MIN_SCORE = 4;
/** 하한을 넘는 기사가 적어도 이만큼은 채운다(점수 순) — 빈 화면 방지 */
const MAJOR_MIN_ITEMS = 24;
/** 상한 — 이 이상은 "모아보기"가 아니라 원본 타임라인이다 */
const MAJOR_MAX_ITEMS = 60;

export function curate(items: NewsItem[]): CurationResult {
  const dropped: DroppedItem[] = [];
  const kept: NewsItem[] = [];

  for (const it of items) {
    const reason = noiseReason(it);
    if (reason) dropped.push({ title: it.title, outlet: it.outlet, reason });
    else kept.push(it);
  }

  // 중복 병합 — 입력이 최신순이므로 먼저 온 기사가 대표가 된다
  const reps: { item: CuratedItem; tokens: Set<string> }[] = [];
  for (const it of kept) {
    const tokens = tokenize(it.title);
    const at = it.publishedAt ? new Date(it.publishedAt).getTime() : 0;

    let merged = false;
    for (const r of reps) {
      const rAt = r.item.publishedAt ? new Date(r.item.publishedAt).getTime() : 0;
      if (at && rAt && Math.abs(at - rAt) > DUP_MAX_GAP_MS) continue;
      if (!isSameStory(tokens, r.tokens)) continue;
      r.item.dupCount += 1;
      if (!r.item.dupOutlets.includes(it.outlet) && it.outlet !== r.item.outlet) {
        r.item.dupOutlets.push(it.outlet);
      }
      merged = true;
      break;
    }
    if (!merged) {
      reps.push({ item: { ...it, dupCount: 0, dupOutlets: [], score: 0 }, tokens });
    }
  }

  const all = reps.map((r) => r.item);
  for (const it of all) it.score = scoreOf(it);

  const byScore = [...all].sort((a, b) => b.score - a.score);
  const overBar = byScore.filter((i) => i.score >= MAJOR_MIN_SCORE);
  const picked = (overBar.length >= MAJOR_MIN_ITEMS ? overBar : byScore.slice(0, MAJOR_MIN_ITEMS))
    .slice(0, MAJOR_MAX_ITEMS);

  // 선별은 중요도로, 표시는 시간순으로 — 사람이 훑는 순서는 시간이다
  const major = [...picked].sort(
    (a, b) =>
      new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime(),
  );

  return { major, all, dropped };
}
