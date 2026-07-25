#!/usr/bin/env python3
"""
probe_etf_sources.py — ETF 전체 목록/시세 소스의 클라우드 도달성 실측 프로브
=============================================================================
목적: "국내 상장 ETF 전체(~900종목)"를 클라우드(GitHub Actions/Vercel)에서
      자동 수집할 수 있는지 후보 소스별로 실제 호출해 검증한다.
      KRX(pykrx)는 클라우드 IP를 차단하므로, 대체 소스의 실측이 필요하다.

후보:
  A. 네이버 ETF 목록 API  (finance.naver.com/api/sise/etfItemList.nhn)
     → 단일 요청으로 전 종목 + 등락률 + 3개월수익률 + 시가총액
  B. 네이버 일별시세 JSON (api.finance.naver.com/siseJson.naver)
     → 종목별 일봉 OHLCV (다구간 수익률 계산용)
  C. Yahoo Finance 차트   (query1.finance.yahoo.com)
     → 현행 프런트가 쓰는 경로(대조군)
  D. pykrx/KRX            (data.krx.co.kr)
     → 기존 경로(클라우드 차단 예상, 확인용)

각 후보의 성공여부/개수/지연시간만 출력한다(부작용 없음).
"""

import json
import sys
import time
import urllib.request
import urllib.error

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")


def _get(url: str, referer: str = "", timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        **({"Referer": referer} if referer else {}),
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def probe(name: str, fn) -> dict:
    t0 = time.time()
    try:
        detail = fn()
        ms = int((time.time() - t0) * 1000)
        print(f"  ✓ {name:32s} OK   ({ms:5d}ms)  {detail}")
        return {"source": name, "ok": True, "ms": ms, "detail": detail}
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        msg = f"{type(e).__name__}: {str(e)[:120]}"
        print(f"  ✗ {name:32s} FAIL ({ms:5d}ms)  {msg}")
        return {"source": name, "ok": False, "ms": ms, "detail": msg}


# ── A. 네이버 ETF 전체 목록 ──────────────────────────────────────────────────
def a_naver_etf_list():
    raw = _get("https://finance.naver.com/api/sise/etfItemList.nhn",
               referer="https://finance.naver.com/sise/etf.naver")
    d = json.loads(raw.decode("utf-8"))
    items = d["result"]["etfItemList"]
    keys = sorted(items[0].keys())
    lev = sum(1 for i in items if "레버리지" in i["itemname"])
    inv = sum(1 for i in items if "인버스" in i["itemname"])
    globals()["_NAVER_SAMPLE"] = items[:5]
    globals()["_NAVER_KEYS"] = keys
    return f"ETF {len(items)}종목 (레버리지 {lev}, 인버스 {inv}) | 필드 {len(keys)}개"


# ── B. 네이버 일별시세(일봉) ────────────────────────────────────────────────
def b_naver_sise_json():
    url = ("https://api.finance.naver.com/siseJson.naver?symbol=069500"
           "&requestType=1&startTime=20240101&endTime=20261231&timeframe=day")
    raw = _get(url, referer="https://finance.naver.com/")
    txt = raw.decode("utf-8", errors="replace").strip()
    # 응답은 파이썬 리터럴 유사 형식 → 따옴표 정규화 후 파싱
    rows = json.loads(txt.replace("'", '"'))
    return f"KODEX200 일봉 {len(rows)-1}행 (헤더 {rows[0][:3]}...)"


# ── C. Yahoo 차트 (대조군) ──────────────────────────────────────────────────
def c_yahoo_chart():
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/069500.KS"
           "?range=1y&interval=1d")
    raw = _get(url)
    d = json.loads(raw.decode("utf-8"))
    ts = d["chart"]["result"][0]["timestamp"]
    return f"069500.KS 일봉 {len(ts)}행"


# ── D. KRX (기존 경로, 차단 예상) ───────────────────────────────────────────
def d_krx():
    url = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
    req = urllib.request.Request(
        url,
        data=b"bld=dbms/MDC/STAT/standard/MDCSTAT04601&mktId=ETF&trdDd=20260702",
        headers={"User-Agent": UA,
                 "Referer": "http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd",
                 "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read().decode("utf-8", errors="replace")
    d = json.loads(body)
    key = next((k for k in d if isinstance(d[k], list)), None)
    return f"rows={len(d.get(key, []))}"


def main() -> None:
    print("[probe] ETF 데이터 소스 클라우드 도달성 검증\n")
    results = [
        probe("A. 네이버 ETF 전체목록", a_naver_etf_list),
        probe("B. 네이버 일별시세(일봉)", b_naver_sise_json),
        probe("C. Yahoo 차트(대조군)", c_yahoo_chart),
        probe("D. KRX(기존경로)", d_krx),
    ]

    if "_NAVER_SAMPLE" in globals():
        print(f"\n[A 상세] 필드: {globals()['_NAVER_KEYS']}")
        print("[A 샘플]")
        for it in globals()["_NAVER_SAMPLE"]:
            print("   ", json.dumps(it, ensure_ascii=False))

    ok = [r["source"] for r in results if r["ok"]]
    print(f"\n[결론] 사용 가능 소스: {ok if ok else '없음'}")
    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
