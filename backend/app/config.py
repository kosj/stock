from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # DB
    DATABASE_URL: str = "sqlite+aiosqlite:///./stock.db"

    # KIS API
    KIS_MODE: str = "mock"
    KIS_APPKEY: str = ""
    KIS_APPSECRET: str = ""
    KIS_ACCOUNT: str = ""
    KIS_BASE_URL: str = "https://openapi.koreainvestment.com:9443"

    # AI
    ANTHROPIC_API_KEY: str = ""

    # FRED (거시경제)
    FRED_API_KEY: str = ""

    # 웹 푸시 (VAPID)
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_EMAIL: str = "mailto:admin@example.com"

    # CORS — 쉼표 구분 또는 * (전체 허용)
    # Railway 환경변수: CORS_ORIGINS=* 또는 https://your-app.vercel.app
    CORS_ORIGINS: str = "*"

    # 앱
    APP_ENV: str = "development"
    SECRET_KEY: str = "dev-secret-key-change-in-production"

    @property
    def cors_origins_list(self) -> List[str]:
        raw = self.CORS_ORIGINS.strip()
        if raw == "*":
            return ["*"]
        return [o.strip() for o in raw.split(",") if o.strip()]

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
