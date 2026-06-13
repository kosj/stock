#!/usr/bin/env python3
"""
종목 유니버스 단일 소스 (Single Source of Truth)
================================================
hybrid_ensemble.py(ML 엔진, CI)와 krx_cache.py(수급·밸류 적재기, KR 로컬)가 공유한다.
의도적으로 무거운 의존성(lightgbm 등)을 두지 않아 어디서든 가볍게 import 가능.
종목 추가/삭제는 여기 한 곳만 수정하면 양쪽에 반영된다.
"""

UNIVERSE = [
    # 반도체
    dict(ticker="005930", name="삼성전자",             sector="반도체",  market="KOSPI"),
    dict(ticker="000660", name="SK하이닉스",           sector="반도체",  market="KOSPI"),
    dict(ticker="042700", name="한미반도체",           sector="반도체",  market="KOSDAQ"),
    dict(ticker="240810", name="원익IPS",              sector="반도체",  market="KOSDAQ"),
    dict(ticker="009150", name="삼성전기",             sector="반도체",  market="KOSPI"),
    dict(ticker="003550", name="LG",                   sector="반도체",  market="KOSPI"),
    dict(ticker="018260", name="삼성에스디에스",       sector="반도체",  market="KOSPI"),
    # 2차전지
    dict(ticker="373220", name="LG에너지솔루션",       sector="2차전지", market="KOSPI"),
    dict(ticker="051910", name="LG화학",               sector="2차전지", market="KOSPI"),
    dict(ticker="003670", name="포스코퓨처엠",         sector="2차전지", market="KOSPI"),
    dict(ticker="247540", name="에코프로비엠",         sector="2차전지", market="KOSDAQ"),
    dict(ticker="086520", name="에코프로",             sector="2차전지", market="KOSDAQ"),
    dict(ticker="006400", name="삼성SDI",              sector="2차전지", market="KOSPI"),
    dict(ticker="096530", name="씨에스윈드",           sector="2차전지", market="KOSPI"),
    # 자동차
    dict(ticker="005380", name="현대차",               sector="자동차",  market="KOSPI"),
    dict(ticker="000270", name="기아",                 sector="자동차",  market="KOSPI"),
    dict(ticker="012330", name="현대모비스",           sector="자동차",  market="KOSPI"),
    dict(ticker="204320", name="HL만도",               sector="자동차",  market="KOSPI"),
    dict(ticker="161390", name="한국타이어앤테크놀로지", sector="자동차", market="KOSPI"),
    # IT/플랫폼
    dict(ticker="035420", name="NAVER",                sector="IT",      market="KOSPI"),
    dict(ticker="035720", name="카카오",               sector="IT",      market="KOSPI"),
    dict(ticker="323410", name="카카오뱅크",           sector="IT",      market="KOSPI"),
    dict(ticker="066570", name="LG전자",               sector="IT",      market="KOSPI"),
    dict(ticker="034730", name="SK",                   sector="IT",      market="KOSPI"),
    # 게임
    dict(ticker="036570", name="NC소프트",             sector="게임",    market="KOSDAQ"),
    dict(ticker="259960", name="크래프톤",             sector="게임",    market="KOSPI"),
    dict(ticker="263750", name="펄어비스",             sector="게임",    market="KOSDAQ"),
    dict(ticker="293490", name="카카오게임즈",         sector="게임",    market="KOSDAQ"),
    dict(ticker="251270", name="넷마블",               sector="게임",    market="KOSPI"),
    # 엔터
    dict(ticker="041510", name="에스엠",               sector="엔터",    market="KOSDAQ"),
    dict(ticker="035900", name="JYP Ent.",             sector="엔터",    market="KOSDAQ"),
    dict(ticker="122870", name="와이지엔터테인먼트",   sector="엔터",    market="KOSDAQ"),
    dict(ticker="352820", name="하이브",               sector="엔터",    market="KOSPI"),
    # 바이오/제약
    dict(ticker="207940", name="삼성바이오로직스",     sector="바이오",  market="KOSPI"),
    dict(ticker="068270", name="셀트리온",             sector="바이오",  market="KOSPI"),
    dict(ticker="128940", name="한미약품",             sector="바이오",  market="KOSDAQ"),
    dict(ticker="145020", name="휴젤",                 sector="바이오",  market="KOSDAQ"),
    dict(ticker="326030", name="SK바이오팜",           sector="바이오",  market="KOSPI"),
    dict(ticker="000100", name="유한양행",             sector="바이오",  market="KOSPI"),
    dict(ticker="302440", name="SK바이오사이언스",     sector="바이오",  market="KOSPI"),
    # 금융
    dict(ticker="105560", name="KB금융",               sector="금융",    market="KOSPI"),
    dict(ticker="055550", name="신한지주",             sector="금융",    market="KOSPI"),
    dict(ticker="086790", name="하나금융지주",         sector="금융",    market="KOSPI"),
    dict(ticker="032830", name="삼성생명",             sector="금융",    market="KOSPI"),
    dict(ticker="316140", name="우리금융지주",         sector="금융",    market="KOSPI"),
    dict(ticker="000810", name="삼성화재",             sector="금융",    market="KOSPI"),
    dict(ticker="005830", name="DB손해보험",           sector="금융",    market="KOSPI"),
    dict(ticker="175330", name="JB금융지주",           sector="금융",    market="KOSPI"),
    dict(ticker="138930", name="BNK금융지주",          sector="금융",    market="KOSPI"),
    dict(ticker="024110", name="기업은행",             sector="금융",    market="KOSPI"),
    # 소재
    dict(ticker="005490", name="POSCO홀딩스",          sector="소재",    market="KOSPI"),
    dict(ticker="010130", name="고려아연",             sector="소재",    market="KOSPI"),
    dict(ticker="004020", name="현대제철",             sector="소재",    market="KOSPI"),
    dict(ticker="001430", name="세아베스틸지주",       sector="소재",    market="KOSPI"),
    # 에너지/화학
    dict(ticker="096770", name="SK이노베이션",         sector="에너지",  market="KOSPI"),
    dict(ticker="010950", name="S-Oil",                sector="에너지",  market="KOSPI"),
    dict(ticker="011170", name="롯데케미칼",           sector="화학",    market="KOSPI"),
    dict(ticker="009830", name="한화솔루션",           sector="화학",    market="KOSPI"),
    dict(ticker="015760", name="한국전력",             sector="유틸리티", market="KOSPI"),
    dict(ticker="034020", name="두산에너빌리티",       sector="유틸리티", market="KOSPI"),
    # 방산
    dict(ticker="012450", name="한화에어로스페이스",   sector="방산",    market="KOSPI"),
    dict(ticker="047810", name="한국항공우주",         sector="방산",    market="KOSPI"),
    dict(ticker="064350", name="현대로템",             sector="방산",    market="KOSPI"),
    dict(ticker="000880", name="한화",                 sector="방산",    market="KOSPI"),
    dict(ticker="042660", name="한화오션",             sector="방산",    market="KOSPI"),
    # 조선/중공업
    dict(ticker="009540", name="HD한국조선해양",       sector="조선",    market="KOSPI"),
    dict(ticker="267250", name="HD현대",               sector="조선",    market="KOSPI"),
    dict(ticker="329180", name="HD현대중공업",         sector="조선",    market="KOSPI"),
    dict(ticker="010140", name="삼성중공업",           sector="조선",    market="KOSPI"),
    # 건설
    dict(ticker="028260", name="삼성물산",             sector="건설",    market="KOSPI"),
    dict(ticker="000720", name="현대건설",             sector="건설",    market="KOSPI"),
    dict(ticker="047040", name="대우건설",             sector="건설",    market="KOSPI"),
    dict(ticker="000210", name="DL이앤씨",             sector="건설",    market="KOSPI"),
    # 유통/소비재
    dict(ticker="139480", name="이마트",               sector="유통",    market="KOSPI"),
    dict(ticker="282330", name="BGF리테일",            sector="유통",    market="KOSPI"),
    dict(ticker="004170", name="신세계",               sector="유통",    market="KOSPI"),
    dict(ticker="069960", name="현대백화점",           sector="유통",    market="KOSPI"),
    dict(ticker="023530", name="롯데쇼핑",             sector="유통",    market="KOSPI"),
    dict(ticker="271560", name="오리온",               sector="소비재",  market="KOSPI"),
    dict(ticker="097950", name="CJ제일제당",           sector="소비재",  market="KOSPI"),
    # 통신
    dict(ticker="017670", name="SK텔레콤",             sector="통신",    market="KOSPI"),
    dict(ticker="030200", name="KT",                   sector="통신",    market="KOSPI"),
    dict(ticker="032640", name="LG유플러스",           sector="통신",    market="KOSPI"),
    # 해운/물류
    dict(ticker="011200", name="HMM",                  sector="해운",    market="KOSPI"),
    dict(ticker="000120", name="CJ대한통운",           sector="물류",    market="KOSPI"),
    dict(ticker="003490", name="대한항공",             sector="물류",    market="KOSPI"),
    dict(ticker="004960", name="한샘",                 sector="물류",    market="KOSPI"),
    # 소부장
    dict(ticker="357780", name="솔브레인",             sector="소부장",  market="KOSDAQ"),
    dict(ticker="166090", name="하나머티리얼즈",       sector="소부장",  market="KOSDAQ"),
    dict(ticker="036830", name="솔브레인홀딩스",       sector="소부장",  market="KOSDAQ"),
    dict(ticker="336370", name="솔루스첨단소재",       sector="소부장",  market="KOSDAQ"),
]
