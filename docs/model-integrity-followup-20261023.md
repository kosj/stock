# 추천 모델 품질 미달 후속 수정

2026-10-23 KST. 최초 실패 실행: https://github.com/kosj/stock/actions/runs/39939372144

관측값: 일별 OOF IC 0.0087 / Newey-West t 0.74 / 609일.
기준 IC >=0.01 / t >=2 / 60일을 충족하지 못해 발행 중단은 정상 동작이다.
이번 변경은 데이터/계산 결함 수정이며 하이퍼파라미터 탐색이나 품질 기준 완화가 아니다.

## 확인·수정한 결함

1. 종목 식별 7건: 상장시장 오기 4건과 회사-티커 오연결 3건.

| 회사 | 기존 | 수정 |
|---|---|---|
| 한미반도체 | 042700 KOSDAQ | 042700 KOSPI |
| 솔루스첨단소재 | 336370 KOSDAQ | 336370 KOSPI |
| NC소프트 | 036570 KOSDAQ | 036570 KOSPI |
| 한미약품 | 128940 KOSDAQ | 128940 KOSPI |
| 씨에스윈드 | 096530 (씨젠 코드) | 112610 KOSPI |
| DL이앤씨 | 000210 (DL 코드) | 375500 KOSPI |
| 한샘 | 004960 (한신공영 코드) | 009240 KOSPI |

금융감독원 DART 기업 정보로 대조했다. 기존 추천 이력/가격 행을 임의 삭제·이름 변경하지 않는다.
과거 잘못된 회사 이름과 연결된 추천 행은 성과 검증 근거로 신뢰하면 안 된다.

공식 근거:
- https://englishdart.fss.or.kr/dsbc001/selectPopup.ax?selectKey=00161383 (042700)
- https://englishdart.fss.or.kr/dsbc001/selectPopup.ax?selectKey=01412822 (336370)
- https://englishdart.fss.or.kr/dsbc001/selectPopup.ax?selectKey=00261443 (036570)
- https://englishdart.fss.or.kr/dsbc001/selectPopup.ax?selectKey=00828497 (128940)
- https://englishdart.fss.or.kr/dsbc001/selectPopup.ax?selectKey=00670340 (112610)
- https://englishdart.fss.or.kr/dsbc001/selectPopup.ax?selectKey=01524093 (375500)
- https://englishdart.fss.or.kr/dsbc001/selectPopup.ax?selectKey=00161693 (009240)

2. KRX 캐시 `limit=3000` 한 번 조회: 서버 응답 상한이 더 작으면 **오래된 첫 페이지만**
   읽어 최신 수급은 0, 재무는 과거 값을 계속 이월할 수 있었다. 실제 수신 행 수만큼
   offset을 이동해 빈 페이지까지 읽는다. 최대 20페이지 제한과 실패 경고를 둔다.
   이번 실패 실행에서 실제 상한이 1000이었는지는 원시 응답이 없어 단정하지 않는다.
3. 12개월-최근 1개월 제외 모멘텀을 `P[t-21]/P[t-252]-1`로 수정했다.
   기존 식은 273일 전을 참조하고 최근 21일 수익을 한 번 더 빼고 있었다.
4. 과거 알파 피처의 시장 수익도 일수익 합 대신 복리수익으로 맞췄다.
5. 학습·최신 예측에 같은 횡단면 정규화를 사용한다. 상수 열은 양쪽 모두 0.
   최신 예측의 필수 피처 결손 행도 학습과 같이 제외해 가짜 0 입력을 만들지 않는다.
6. 품질 미달 모델의 불필요한 전체 재학습을 생략한다. 기준 미달 실패 상태를 유지하고
   `model-quality.json`에 항목별 통과 여부를 저장, Actions artifact로 보존한다.

## 동일 입력 비교

`scripts/model_research.py`와 `Frozen-input model comparison` Actions를 추가했다.
모델 관련 파일 변경 push와 workflow_dispatch에서만 진단하며 주간 추천 발행을 추가 실행하지 않는다.

- 고정 baseline: `3bac8616e2d724f523d03223e9a6b196d5feb6a9`.
- 저장된 가격 snapshot과 전체 KRX 캐시를 읽는다. 저장본 없는 수정 종목만 공개 가격을
  읽고 저장하지 않는다. 가격 발행·추천 발행·뉴스 저장·주문/계좌 쓰기 호출 없음.
- 두 모델에 동일 캡처 입력을 제공하고 훈련 날짜·분할 캘린더를 맞춘다.
  유니버스 정정에 따른 구성 변화와 제외 종목은 별도 보고한다.
- 공통 티커/날짜의 동일 실제 라벨로 전체 및 최근 126 평가일 IC 차이와 paired NW t를 계산한다.
- 두 모델 모두 전체 KRX 캐시를 사용하므로 이전 페이지 잘림의 효과까지 재현하는 비교는 아니다.
- `inputs.json.gz`, 입력/소스 SHA256, `dependencies.txt`, `report.json`을 artifact에 30일 보관한다.
- 재실행: artifact를 내려받고 같은 baseline과 `--input inputs.json.gz`를 제공한다.
- 기준은 고정하며, 비교 결과로 자동 모델 선택·운영 승격·추천 발행을 하지 않는다.

최근 126일은 이미 이전 지표에 포함됐던 과거 자료라 **미관측 holdout으로 부르지 않는다**.
현재 종목 구성 기반 생존편향, 당시 재무/기업행위 관측시점, 최종 뉴스/변동성 혼합·섹터 제한,
체결/비용/세금은 별도 검증이 필요하다. 이 진단은 거래 수익률이나 수익 개선 증거가 아니다.

## 검증 / 다음 세션

Node 전체 70개, Python 26개 테스트, 타입 검사·lint 기준선(기존59/신규0)·SQL 감사가 통과했다.
합성 입력으로 baseline/candidate 전체 비교 흐름과 공통 행 2,484개 정합성도 검증했다.
합성 입력의 IC 수치는 실제 성능이 아니다.
실자료 비교와 원격 CI/배포 결과는 실행 완료 후 이 문서에 추가한다.
`ml/hybrid_stacking_ensemble.py`의 사용자 수정은 포함하지 않는다.
품질 기준 미달이면 신규 자동매수 보류를 유지하고 향후 관측 데이터로 검증을 계속한다.
