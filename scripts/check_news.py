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

종료 코드: 0 정상(경고 포함) / 1 결함
"""
import json
import sys
from collections import Counter

UNDATED_WARN_RATIO = 0.30   # 시간 미상이 30%를 넘으면 파싱 이상 의심
DOMINANCE_WARN = 0.50       # 한 매체가 50%를 넘으면 편중 경고

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
for w in warns:
    print(f"::warning::{w}")
for e in errors:
    print(f"::error::{e}")
print("판정:", "결함 있음" if errors else ("정상(경고 있음)" if warns else "정상"))
sys.exit(1 if errors else 0)
