#!/usr/bin/env python3
"""
추천 종목 API 응답 건전성 검사 (러너 전용 스모크)

/api/recommendations/prophet 응답을 받아 "정상 추천되고 있는가"를 판정한다.
로그를 눈으로 훑는 대신 깨질 수 있는 지점을 명시적으로 검사한다:

  1) 신선도    — run_date 가 며칠 지났나 (정기 잡 누락·지연 탐지)
  2) 완전성    — Top20 20건, rank 1~20 유일
  3) 필드      — 화면이 쓰는 필수 값이 null 이 아닌가
  4) 섹터 상한 — SECTOR_CAP(5) 준수 (라벨 오류로 상한이 새면 여기서 걸린다)
  5) 분포      — 기대수익률 범위가 비현실적이지 않은가

종료 코드: 0 정상(경고 포함) / 1 결함
"""
import argparse
import json
import sys
from collections import Counter
from datetime import date, datetime, timedelta, timezone

SECTOR_CAP = 5
TOP_N = 20
STALE_WARN_DAYS = 2      # 주말 끼면 2일까지는 정상
STALE_FAIL_DAYS = 5
REQUIRED = ["ticker", "name", "current_price", "predicted_return_30d", "recommendation"]

ap = argparse.ArgumentParser(description="추천 API 응답 건전성 검사")
ap.add_argument("path", nargs="?", default="rec.json")
ap.add_argument("--daily-monitor", action="store_true",
                help="정기 감시 모드: 직전 거래일(평일)의 run_date 가 반드시 있어야 한다")
args = ap.parse_args()
path = args.path
d = json.load(open(path))
rows = d.get("rows") or []
run_date = d.get("run_date")

errors, warns = [], []

print(f"run_date = {run_date} | rows = {len(rows)}")

# 1) 신선도
if not run_date:
    errors.append("run_date 없음 — 저장된 추천이 하나도 없다")
else:
    age = (date.today() - datetime.strptime(run_date, "%Y-%m-%d").date()).days
    print(f"신선도   = {age}일 경과")
    if age >= STALE_FAIL_DAYS:
        errors.append(f"추천이 {age}일 묵었다 — 정기 잡이 멈춘 것으로 보인다")
    elif age > STALE_WARN_DAYS:
        warns.append(f"추천이 {age}일 경과 — 정기 잡 지연/누락 가능")

# 1-b) 정기 감시 모드 — "있어야 할 날의 추천이 있는가"
#   정기 잡은 평일 UTC 07:12~13:27 슬롯 5개로 돈다(지연 시 몇 시간 뒤 실행).
#   감시 잡 자체도 schedule 이라 지연될 수 있으므로 "지금 시각"을 기준으로
#   기대일을 정한다:
#     UTC 14시 이후  → 오늘(평일이면). 5개 슬롯이 모두 지나고도 여유가 있는 시각.
#     UTC 14시 이전  → 어제 이전의 마지막 평일. 감시가 다음날 새벽으로 밀려도
#                     아직 돌지 않은 오늘 것을 요구해 오탐하지 않게 한다.
#   기대일이 주말이면 직전 금요일로 물린다. 한국 공휴일에도 정기 잡은 그대로
#   돌아 run_date 를 남기므로 별도 달력은 필요 없다.
if args.daily_monitor and run_date:
    now = datetime.now(timezone.utc)
    cand = now.date() if now.hour >= 14 else now.date() - timedelta(days=1)
    while cand.weekday() >= 5:          # 5=토, 6=일
        cand -= timedelta(days=1)
    expected = cand
    have = datetime.strptime(run_date, "%Y-%m-%d").date()
    print(f"감시기준 = {now.strftime('%Y-%m-%d %H:%M')} UTC → 기대 run_date {expected}")
    if have < expected:
        errors.append(
            f"{expected} 추천이 없다 (최신 {run_date}, {(expected - have).days}거래일 전) "
            f"— 정기 슬롯 5개(16:12~22:27 KST)가 모두 누락되거나 지연됐다"
        )

# 2) 완전성
if len(rows) != TOP_N:
    errors.append(f"Top{TOP_N} 이어야 하는데 {len(rows)}건")
ranks = [r.get("rank") for r in rows]
if sorted(r for r in ranks if r is not None) != list(range(1, len(rows) + 1)):
    errors.append(f"rank 가 1~{len(rows)} 연속·유일이 아니다: {ranks}")

# 3) 필수 필드
for r in rows:
    missing = [f for f in REQUIRED if r.get(f) in (None, "")]
    if missing:
        errors.append(f"{r.get('name') or r.get('ticker')}: 필수 필드 누락 {missing}")

# 4) 섹터 상한
sec = Counter(r.get("sector") or "?" for r in rows)
over = {k: v for k, v in sec.items() if v > SECTOR_CAP}
print("섹터 분포 =", dict(sec.most_common()))
if over:
    errors.append(f"섹터 상한({SECTOR_CAP}) 초과: {over} — 라벨 오류로 상한이 새는지 확인")

# 5) 기대수익률 분포
vals = [r.get("predicted_return_30d") for r in rows if r.get("predicted_return_30d") is not None]
if vals:
    lo, hi = min(vals), max(vals)
    print(f"기대수익률(30일) = {lo:+.2f} ~ {hi:+.2f}")
    if hi > 100 or lo < -100:
        errors.append(f"기대수익률이 비현실적이다 ({lo:+.2f}~{hi:+.2f}) — 단위/스케일 확인")
    if len(set(round(v, 4) for v in vals)) <= 1:
        errors.append("전 종목 기대수익률이 동일 — 예측 붕괴")

# 6) 순위 근거와 표시값의 부호 정합성
#    rank/recommendation 은 10일 알파 혼합(risk_adj_score)으로 정해지는데,
#    화면의 "30일 예측"은 별개의 30일 독립 모델 값이다. 두 모델이 엇갈리면
#    "매수 추천인데 예측은 큰 폭 하락" 같은 모순이 화면에 그대로 노출된다.
contradict = [
    (r.get("name"), r.get("rank"), r.get("predicted_return_30d"), r.get("recommendation"))
    for r in rows
    if str(r.get("recommendation", "")).endswith("buy")
    and (r.get("predicted_return_30d") or 0) < 0
]
if contradict:
    warns.append(
        "매수 추천인데 30일 예측이 음수인 종목 "
        + ", ".join(f"{n}({rk}위 {v:+.2f}%)" for n, rk, v, _ in contradict)
        + " — 순위는 10일 알파, 표시는 30일 독립 모델이라 부호가 엇갈릴 수 있다"
    )

print()
for r in rows[:TOP_N]:
    print(f"  {r.get('rank'):>2}. {r.get('name','?'):<14} {str(r.get('sector','?')):<8} "
          f"{r.get('predicted_return_30d'):+.2f}%  현재가 {r.get('current_price'):,.0f}")

print()
for w in warns:
    print(f"::warning::{w}")
for e in errors:
    print(f"::error::{e}")
print("판정:", "결함 있음" if errors else ("정상(경고 있음)" if warns else "정상"))
sys.exit(1 if errors else 0)
