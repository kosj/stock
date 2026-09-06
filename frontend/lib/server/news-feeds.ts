/**
 * 뉴스 피드 수집 — 국내외 금융 RSS 통합
 * ============================================================================
 * 설계 원칙
 *  1. 기사를 지어내지 않는다. 피드가 전부 실패하면 빈 목록 + 실패 사유를 올린다.
 *     (표본 헤드라인을 만들어 보여주면 사용자가 실제 시황으로 오인한다)
 *  2. 부분 실패를 삼키지 않는다. 어느 소스가 끊겼는지 응답에 담아 화면에 알린다.
 *     한 곳이 죽어도 나머지는 보여주되, 죽었다는 사실을 숨기지 않는다.
 *  3. 피드는 언제든 죽거나 형식이 바뀐다 — scripts/probe_news_feeds.py 로 실측 후
 *     이 목록을 갱신한다.
 *
 * RSS 2.0 과 Atom 을 모두 다룬다. 파싱은 cheerio(xmlMode) — 이미 의존성에 있다.
 */

import * as cheerio from "cheerio";

export type Region = "domestic" | "global";

export interface FeedSource {
  id: string;
  name: string;
  url: string;
  region: Region;
  /** 화면 배지에 쓰는 짧은 매체명 */
  outlet: string;
}

/**
 * 피드 목록.
 * 한 매체에서 너무 많이 가져오면 특정 매체가 타임라인을 도배하므로
 * 매체당 1~2개로 제한한다(아래 PER_FEED_LIMIT 과 함께 작동).
 */
export const FEEDS: FeedSource[] = [
  // ── 국내 ──────────────────────────────────────────────────────────────
  { id: "yna-econ",   name: "연합뉴스 경제", outlet: "연합뉴스", url: "https://www.yna.co.kr/rss/economy.xml",       region: "domestic" },
  { id: "yna-market", name: "연합뉴스 증권", outlet: "연합뉴스", url: "https://www.yna.co.kr/rss/market.xml",        region: "domestic" },
  { id: "hk-econ",    name: "한국경제 경제", outlet: "한국경제", url: "https://www.hankyung.com/feed/economy",       region: "domestic" },
  { id: "hk-fin",     name: "한국경제 금융", outlet: "한국경제", url: "https://www.hankyung.com/feed/finance",       region: "domestic" },
  { id: "mk-econ",    name: "매일경제 경제", outlet: "매일경제", url: "https://www.mk.co.kr/rss/30100041/",          region: "domestic" },
  { id: "mk-stock",   name: "매일경제 증권", outlet: "매일경제", url: "https://www.mk.co.kr/rss/50200011/",          region: "domestic" },
  { id: "asiae-stock", name: "아시아경제 증권", outlet: "아시아경제", url: "https://www.asiae.co.kr/rss/stock.htm",     region: "domestic" },
  { id: "newsis-econ", name: "뉴시스 경제",     outlet: "뉴시스",     url: "https://newsis.com/RSS/economy.xml",        region: "domestic" },

  // ── 해외 ──────────────────────────────────────────────────────────────
  { id: "cnbc-top",   name: "CNBC Top News", outlet: "CNBC",        url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", region: "global" },
  { id: "cnbc-fin",   name: "CNBC Finance",  outlet: "CNBC",        url: "https://www.cnbc.com/id/10000664/device/rss/rss.html",  region: "global" },
  { id: "cnbc-mkt",   name: "CNBC Markets",  outlet: "CNBC",        url: "https://www.cnbc.com/id/20910258/device/rss/rss.html",  region: "global" },
  { id: "mw-top",     name: "MarketWatch",   outlet: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", region: "global" },
  { id: "yahoo-fin",  name: "Yahoo Finance", outlet: "Yahoo",       url: "https://finance.yahoo.com/news/rssindex",               region: "global" },
  { id: "investing",  name: "Investing.com", outlet: "Investing",   url: "https://www.investing.com/rss/news.rss",                region: "global" },
  { id: "ft-home",    name: "Financial Times", outlet: "FT",        url: "https://www.ft.com/rss/home",                           region: "global" },
  { id: "scmp-biz",   name: "SCMP Business", outlet: "SCMP",        url: "https://www.scmp.com/rss/92/feed",                      region: "global" },
];

// ── 피드 선정 규칙 ──────────────────────────────────────────────────────
// URL 에 섹션(economy / stock / finance)이 드러나는 피드만 쓴다.
// 섹션이 불명확한 전체 피드는 스포츠·연예가 섞여 들어오는데, 도달성(HTTP 200,
// 항목 수)만으로는 이를 잡을 수 없다. 실측으로 확인된 함정이다 — 아래 조선비즈.
// 내용 확인은 probe-news-feeds 워크플로의 dump_url 입력으로 한다.

// 실측에서 뺀 후보 (scripts/probe_news_feeds.py, 2026-09-06 러너 기준)
//   이데일리·서울경제·한국경제 증권·KBS 경제 : 도달 실패 또는 항목 0
//   Reuters businessNews                    : DNS 해석 실패(피드 폐지)
//   MarketWatch MarketPulse                 : HTTP 200 이지만 최신 기사가
//                                             2025-07-03 — 갱신이 멈춘 피드다.
//                                             살아 있어 보이지만 죽은 소스라
//                                             타임라인에 과거 기사를 섞는다.
//   조선비즈 아웃바운드 피드                : HTTP 200·항목 다수지만 40건 중 금융은
//                                             1건뿐이고 나머지가 sports_photo 16,
//                                             enter_general 10 등 스포츠·연예였다.
//                                             category 태그도 비어 있어 걸러낼 수
//                                             없다. 금융 피드가 아니라 전사 스트림.
//   머니투데이 mt_news.xml                  : 도달은 되지만 섹션이 불명확한 전체
//                                             피드다. 조선비즈와 같은 함정일 수
//                                             있어 내용 확인 전까지 보류.
//   Nikkei Asia                             : 항목 50개인데 발행시각 파싱 불가.
//                                             전부 "시간 미상"으로 목록 끝에
//                                             쌓여 잡음만 된다. 날짜 필드 확인 후 재검토.

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  /** ISO 문자열. 파싱 불가 시 null — 화면에서 "시간 미상"으로 표기한다 */
  publishedAt: string | null;
  outlet: string;
  sourceId: string;
  region: Region;
  summary: string;
}

export interface FeedFailure {
  id: string;
  name: string;
  reason: string;
}

const FETCH_TIMEOUT_MS = 8_000;
/** 매체 한 곳이 타임라인을 도배하지 않도록 피드당 상한 */
const PER_FEED_LIMIT = 12;

const UA =
  "Mozilla/5.0 (compatible; StockBoard/1.0; +https://github.com/kosj/stock)";

/** HTML 엔티티·태그 제거 후 공백 정리 (요약문에 마크업이 섞여 오는 피드가 많다) */
function clean(raw: string, maxLen = 180): string {
  const text = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

/** RSS pubDate / Atom updated 모두 처리. 미래 시각은 신뢰하지 않는다. */
function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = new Date(raw.trim());
  if (isNaN(t.getTime())) return null;
  // 일부 피드가 타임존을 잘못 붙여 미래로 찍힌다 → 24시간 넘게 미래면 버린다
  if (t.getTime() - Date.now() > 86_400_000) return null;
  return t.toISOString();
}

/** RSS 2.0 <item> 과 Atom <entry> 를 함께 파싱한다 */
function parseFeed(xml: string, src: FeedSource): NewsItem[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const nodes = $("item").length ? $("item") : $("entry");

  const out: NewsItem[] = [];
  nodes.each((_, el) => {
    if (out.length >= PER_FEED_LIMIT) return;
    const node = $(el);

    const title = clean(node.find("title").first().text(), 200);
    // Atom 은 <link href="…">, RSS 는 <link>텍스트</link>
    const link =
      node.find("link").first().attr("href")?.trim() ||
      node.find("link").first().text().trim() ||
      node.find("guid").first().text().trim();

    if (!title || !link || !/^https?:\/\//i.test(link)) return;

    const published =
      parseDate(node.find("pubDate").first().text()) ??
      parseDate(node.find("published").first().text()) ??
      parseDate(node.find("updated").first().text()) ??
      parseDate(node.find("dc\\:date").first().text());

    const summary = clean(
      node.find("description").first().text() ||
        node.find("summary").first().text() ||
        node.find("content").first().text(),
    );

    out.push({
      id: `${src.id}:${link}`,
      title,
      link,
      publishedAt: published,
      outlet: src.outlet,
      sourceId: src.id,
      region: src.region,
      summary,
    });
  });
  return out;
}

async function fetchOne(
  src: FeedSource,
): Promise<{ items: NewsItem[]; failure: FeedFailure | null }> {
  try {
    const res = await fetch(src.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
      headers: {
        "User-Agent": UA,
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) {
      return {
        items: [],
        failure: { id: src.id, name: src.name, reason: `HTTP ${res.status}` },
      };
    }
    const items = parseFeed(await res.text(), src);
    if (items.length === 0) {
      // 200 인데 항목이 없으면 형식이 바뀐 것 — 조용히 넘기면 원인을 못 찾는다
      return {
        items: [],
        failure: { id: src.id, name: src.name, reason: "형식 변경 추정(항목 0)" },
      };
    }
    return { items, failure: null };
  } catch (err) {
    const reason =
      err instanceof Error
        ? err.name === "TimeoutError"
          ? "응답 시간 초과"
          : err.message.slice(0, 60)
        : "조회 실패";
    return { items: [], failure: { id: src.id, name: src.name, reason } };
  }
}

export interface NewsResult {
  items: NewsItem[];
  failures: FeedFailure[];
  fetchedAt: string;
}

/**
 * 지정 지역(미지정 시 전체)의 피드를 병렬 수집해 최신순으로 합친다.
 * 한 피드가 죽어도 나머지는 반환하되 failures 에 남긴다.
 */
export async function collectNews(region?: Region): Promise<NewsResult> {
  const targets = region ? FEEDS.filter((f) => f.region === region) : FEEDS;
  const settled = await Promise.all(targets.map(fetchOne));

  const seenLinks = new Set<string>();
  const seenTitles = new Set<string>();
  const items: NewsItem[] = [];
  const failures: FeedFailure[] = [];

  for (const r of settled) {
    if (r.failure) failures.push(r.failure);
    for (const it of r.items) {
      // 같은 기사가 여러 피드에 걸리는 경우가 흔하다(경제/증권 중복 등).
      // 링크와 제목 양쪽으로 거른다 — 매체가 URL 파라미터만 다르게 주기도 한다.
      const titleKey = it.title.replace(/\s/g, "").toLowerCase();
      if (seenLinks.has(it.link) || seenTitles.has(titleKey)) continue;
      seenLinks.add(it.link);
      seenTitles.add(titleKey);
      items.push(it);
    }
  }

  // 시각 미상은 뒤로 (없는 시각을 0으로 두면 최신 목록 맨 뒤로 밀려 자연스럽다)
  items.sort(
    (a, b) =>
      new Date(b.publishedAt ?? 0).getTime() -
      new Date(a.publishedAt ?? 0).getTime(),
  );

  return { items, failures, fetchedAt: new Date().toISOString() };
}
