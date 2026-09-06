#!/usr/bin/env python3
"""
뉴스 API 응답 건전성 검사 (러너 전용 스모크)

/api/news 응답을 받아 "뉴스가 정상적으로 모이고 있는가"를 판정한다.
RSS 는 예고 없이 죽거나 형식이 바뀌므로, 눈으로 훑는 대신 깨질 수 있는
지점을 명시적으로 검사한다:

  1) 기사 존재     — 0건이면 결함
  2) 지역 균형     — 국내/해외 한쪽이 통째로 비면 그쪽 피드가 전부 끊긴 것
  3) 죽은 소스     — failures 를 경고로 드러낸다(부분 실패를 삼키지 않는다)
  4) 발행시각      — '시간 미상' 비율이 과하면 파서와 피드 형식이 어긋난 신호
  5) 매체 편중     — 한 매체가 절반을 넘으면 다른 소스가 조용히 죽은 것
  6) 선별 결과     — 정형 게시물([사진]·[표]·[부고] 등)과 1인칭 상담 칼럼이
                     목록에 남아 있으면 필터가 깨진 것. 중복 병합량도 확인한다.

종료 코드: 0 정상(경고 포함) / 1 결함
"""
import json
import sys
from collections import Counter

import re

UNDATED_WARN_RATIO = 0.30   # 시간 미상이 30%를 넘으면 파싱 이상 의심
DOMINANCE_WARN = 0.50       # 한 매체가 50%를 넘으면 편중 경고

# 선별을 통과하면 안 되는 제목들. 필터가 무력화되면 여기서 잡힌다.
LEAK_PATTERNS = [
    (re.compile(r"(^|\s)\[(사진|포토|표|부고|인사|동정|게시판|알림|공고|운세|날씨)\]"), "정형 게시물"),
    (re.compile(r"^[\"'\u2018\u201c]?(i['\u2019]m|we['\u2019]re|my |our |dear )", re.I), "1인칭 상담 칼럼"),
]

path = sys.argv[1] if len(sys.argv) > 1 else "news.json"
d = json.load(open(path))
items = d.get("items") or []
failures = d.get("failures") or []

errors, warns = [], []

region = Counter(i.get("region") for i in items)
outlet = Counter(i.get("outlet") for i in items)
undated = sum(1 for i in items if not i.get("publishedAt"))

print(f"기사 {len(items)}건 | 국내 {region.get('domestic', 0)} · 해외 {region.get('global', 0)}")
print(f"매체 분포 = {dict(outlet.most_common())}")
print(f"시간 미상 = {undated}건")
if d.get("fetchedAt"):
    print(f"수집 시각 = {d['fetchedAt']}")

# 1) 기사 존재
if not items:
    errors.append("기사 0건 — 모든 피드가 실패했다")

# 2) 지역 균형
if items:
    if region.get("domestic", 0) == 0:
        errors.append("국내 기사 0건 — 국내 피드가 전부 끊겼다")
    if region.get("global", 0) == 0:
        errors.append("해외 기사 0건 — 해외 피드가 전부 끊겼다")

# 3) 죽은 소스
for f in failures:
    warns.append(f"피드 실패 {f.get('name')} — {f.get('reason')}")

# 4) 발행시각 파싱
if items and undated / len(items) > UNDATED_WARN_RATIO:
    warns.append(
        f"시간 미상이 {undated}/{len(items)}건 ({undated / len(items):.0%}) — "
        f"피드 날짜 형식이 파서와 어긋났을 수 있다"
    )

# 5) 매체 편중
if items:
    top, n = outlet.most_common(1)[0]
    if n / len(items) > DOMINANCE_WARN:
        warns.append(
            f"{top} 가 전체의 {n / len(items):.0%} — 다른 매체 피드가 조용히 죽었는지 확인"
        )

print()
for i in items[:8]:
    print(f"  [{i.get('outlet')}] {str(i.get('title'))[:64]}")

print()
# 6) 선별 결과
totals = d.get("totals") or {}
if totals:
    print(
        f"선별 = 수집 {totals.get('collected')} → 중복 병합 {totals.get('mergedAway')} "
        f"· 비기사 제외 {totals.get('droppedNoise')} → 병합후 {totals.get('merged')} "
        f"· 주요 {totals.get('major')}  (mode={d.get('mode')})"
    )
    if d.get("mode") == "major" and not totals.get("major"):
        errors.append("주요 목록이 0건 — 선별 기준이 너무 빡빡하거나 점수 산출이 깨졌다")
    # 중복이 전혀 안 잡히면 병합 로직이 죽은 것이다(여러 매체가 같은 사건을
    # 안 쓰는 날은 없다). 반대로 과반이 병합되면 임계값이 느슨한 것이다.
    coll, away = totals.get("collected") or 0, totals.get("mergedAway") or 0
    if coll >= 60 and away == 0:
        warns.append("중복 병합 0건 — 유사도 판정이 동작하지 않는지 확인 필요")
    if coll and away / coll > 0.5:
        warns.append(f"수집분의 {away/coll:.0%}가 중복으로 병합 — 임계값이 느슨할 수 있다")
else:
    warns.append("totals 필드 없음 — 구버전 응답이거나 선별이 적용되지 않았다")

# 무엇이 왜 빠졌는지 로그에 남긴다(?debug=1 응답에만 포함).
# 필터가 과하게 잡아내고 있는지는 목록을 눈으로 봐야 알 수 있다.
dropped = d.get("dropped") or []
if dropped:
    by_reason = Counter(x.get("reason") for x in dropped)
    print(f"제외 = {len(dropped)}건 {dict(by_reason)}")
    for x in dropped[:6]:
        print(f"  [{x.get('outlet','')}] {x.get('title','')[:56]}")

leaks = [
    (i.get("title", ""), label)
    for i in items
    for pat, label in LEAK_PATTERNS
    if pat.search(i.get("title", ""))
]
if leaks:
    errors.append(
        "선별을 통과하면 안 되는 항목 "
        + ", ".join(f"{lab}: {t[:40]}" for t, lab in leaks[:5])
        + (f" 외 {len(leaks)-5}건" if len(leaks) > 5 else "")
    )

dups = [i for i in items if (i.get("dupCount") or 0) > 0]
if dups:
    print(f"복수 매체 보도 = {len(dups)}건")
    for i in sorted(dups, key=lambda x: -x["dupCount"])[:5]:
        outlets = ", ".join([i.get("outlet", "")] + (i.get("dupOutlets") or []))
        print(f"  {i['dupCount']+1}개 매체 | {i.get('title','')[:52]}  ({outlets})")

for w in warns:
    print(f"::warning::{w}")
for e in errors:
    print(f"::error::{e}")
print("판정:", "결함 있음" if errors else ("정상(경고 있음)" if warns else "정상"))
sys.exit(1 if errors else 0)
