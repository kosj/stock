"""Fail closed: damaged labels and unrelated scraped tables are not KRX data."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException


def _last_trading_day() -> str:
    """Weekday candidate only, not a verified exchange calendar."""
    day = datetime.now(ZoneInfo("Asia/Seoul"))
    if day.hour < 16:
        day -= timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day.strftime("%Y%m%d")


async def _unavailable(*args, **kwargs):
    raise HTTPException(status_code=503, detail="Legacy KRX source requires verified restoration; fabricated proxy statistics are disabled")


get_investor_trends = _unavailable
get_sector_index = _unavailable
get_short_selling = _unavailable
get_dashboard = _unavailable
get_raw = _unavailable
