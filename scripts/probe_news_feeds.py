#!/usr/bin/env python3
"""
뉴스 RSS 피드 도달성 진단 (수동 전용)
=====================================
뉴스 페이지가 쓸 피드를 "될 것 같다"가 아니라 실측으로 고르기 위한 잡.
에이전트/로컬 환경에서는 언론사 도메인이 아웃바운드 정책에 막혀 있어
(HTTP 000) 러너에서만 확인할 수 있다.

피드는 언제든 죽거나 형식이 바뀐다. 페이지가 비면 이 잡을 돌려
어느 소스가 끊겼는지 먼저 확인한다.

각 피드에 대해: HTTP 코드, 항목 수, 최신 항목 제목/시각, 응답 지연을 출력.
종료 코드는 항상 0 (진단 목적이며 CI 게이트가 아님).
"""
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = "Mozilla/5.0 (compatible; StockBoard/1.0; +https://github.com/kosj/stock)"

FEEDS = [
    # ── 국내 ──
    ("연합뉴스 경제",   "https://www.yna.co.kr/rss/economy.xml"),
    ("연합뉴스 증권",   "https://www.yna.co.kr/rss/market.xml"),
    ("매일경제 경제",   "https://www.mk.co.kr/rss/30100041/"),
    ("매일경제 증권",   "https://www.mk.co.kr/rss/50200011/"),
    ("한국경제 경제",   "https://www.hankyung.com/feed/economy"),
    ("한국경제 금융",   "https://www.hankyung.com/feed/finance"),
    ("한국경제 증권",   "https://www.hankyung.com/feed/stock"),
    ("이데일리 경제",   "https://rss.edaily.co.kr/edaily_economy.xml"),
    ("서울경제",        "https://www.sedaily.com/RSS/S1N1.xml"),
    # 조선비즈 아웃바운드 피드는 제외 — 실측 결과 40건 중 금융 1건이고 나머지는
    # 스포츠/연예였다(sports_photo 16, enter_general 10). category 태그도 비어 있어
    # 걸러낼 방법이 없다. 금융 피드가 아니라 전사 기사 스트림이다.
    ("KBS 경제",        "https://news.kbs.co.kr/news/AllNewsRss.xml?cate=economy"),
    # ── 국내 대체 후보 (조선비즈 제외로 줄어든 매체 폭을 메울 수 있는지 실측) ──
    ("이데일리 대체",   "https://www.edaily.co.kr/rss/rss_economy.xml"),
    ("서울경제 증권",   "https://www.sedaily.com/RSS/Stock.xml"),
    ("헤럴드경제",      "https://biz.heraldcorp.com/common/rss_xml.php?ct=010000000000.xml"),
    ("아시아경제 증권", "https://www.asiae.co.kr/rss/stock.htm"),
    ("뉴시스 경제",     "https://newsis.com/RSS/economy.xml"),
    ("파이낸셜뉴스",    "https://www.fnnews.com/rss/fn_realnews_economy.xml"),
    ("머니투데이",      "https://rss.mt.co.kr/mt_news.xml"),
    # ── 해외 ──
    ("CNBC Top",        "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    ("CNBC Finance",    "https://www.cnbc.com/id/10000664/device/rss/rss.html"),
    ("CNBC Markets",    "https://www.cnbc.com/id/20910258/device/rss/rss.html"),
    ("MarketWatch Top", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
    ("MarketWatch Mkt", "https://feeds.content.dowjones.io/public/rss/mw_marketpulse"),
    ("Yahoo Finance",   "https://finance.yahoo.com/news/rssindex"),
    ("Investing.com",   "https://www.investing.com/rss/news.rss"),
    ("Reuters Biz",     "https://feeds.reuters.com/reuters/businessNews"),
    ("Financial Times", "https://www.ft.com/rss/home"),
    ("Nikkei Asia",     "https://asia.nikkei.com/rss/feed/nar"),
    ("SCMP Business",   "https://www.scmp.com/rss/92/feed"),
]

TAG = re.compile(r"<(item|entry)[\s>]", re.I)
TITLE = re.compile(r"<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", re.I | re.S)
DATE = re.compile(r"<(pubDate|updated|published|dc:date)[^>]*>(.*?)</\1>", re.I | re.S)


def probe(entry):
    name, url = entry
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": UA,
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        })
        with urllib.request.urlopen(req, timeout=15) as r:
            code = r.status
            body = r.read(400_000).decode("utf-8", "replace")
    except Exception as exc:
        return (name, url, 0, 0, f"{type(exc).__name__}: {str(exc)[:70]}", "", time.time() - t0)

    n = len(TAG.findall(body))
    titles = [t.strip() for t in TITLE.findall(body)]
    dates = [d[1].strip() for d in DATE.findall(body)]
    # 첫 title 은 채널 제목인 경우가 많아 두 번째를 최신 기사로 본다
    latest = titles[1] if len(titles) > 1 else (titles[0] if titles else "")
    return (name, url, code, n, latest[:56], (dates[0][:31] if dates else ""), time.time() - t0)


def main() -> None:
    print(f"뉴스 피드 도달성 진단 — {len(FEEDS)}개\n" + "=" * 92)
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(probe, FEEDS))

    ok = []
    for name, url, code, n, latest, date, dt in results:
        mark = "OK " if (code == 200 and n > 0) else "NG "
        if code == 200 and n > 0:
            ok.append((name, url))
        print(f"{mark} {name:<16} HTTP {code:<3} items={n:<3} {dt:4.1f}s  {latest}")
        if date:
            print(f"{'':4}{'':<16} 최신: {date}")
    print("=" * 92)
    print(f"사용 가능: {len(ok)}/{len(FEEDS)}")
    print("\n[사용 가능 피드 목록]")
    for name, url in ok:
        print(f"  {name}|{url}")




# ─────────────────────────────────────────────────────────────────────────────
# 상세 덤프 모드 — 특정 피드의 항목별 링크/카테고리를 찍는다.
#   사용: python3 scripts/probe_news_feeds.py --dump "<feed url>"
# 전체 아웃바운드 피드(예: 조선비즈)는 경제 외 기사가 섞여 오는데, 걸러낼 수
# 있는 필드(category, 링크 경로)가 있는지는 실제 응답을 봐야 알 수 있다.
# ─────────────────────────────────────────────────────────────────────────────
ITEM_BLOCK = re.compile(r"<item[\s>].*?</item>", re.I | re.S)
LINK_RE = re.compile(r"<link[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</link>", re.I | re.S)
CAT_RE = re.compile(r"<category[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</category>", re.I | re.S)


def dump(url: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read(600_000).decode("utf-8", "replace")
    blocks = ITEM_BLOCK.findall(body)
    print(f"{url}\n항목 {len(blocks)}개\n" + "-" * 92)
    from urllib.parse import urlparse
    paths = {}
    for b in blocks[:40]:
        title = (TITLE.search(b).group(1).strip() if TITLE.search(b) else "")[:44]
        link = (LINK_RE.search(b).group(1).strip() if LINK_RE.search(b) else "")
        cats = ", ".join(c.strip() for c in CAT_RE.findall(b))[:40]
        seg = "/".join(urlparse(link).path.strip("/").split("/")[:2])
        paths[seg] = paths.get(seg, 0) + 1
        print(f"  [{seg:<28}] cat={cats:<40} {title}")
    print("-" * 92)
    print("링크 경로 분포:", dict(sorted(paths.items(), key=lambda kv: -kv[1])))


if __name__ == "__main__" and len(sys.argv) > 2 and sys.argv[1] == "--dump":
    dump(sys.argv[2])
    sys.exit(0)


if __name__ == "__main__":
    main()
