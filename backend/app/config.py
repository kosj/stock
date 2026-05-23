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

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000"

    # 앱
    APP_ENV: str = "development"
    SECRET_KEY: str = "dev-secret-key-change-in-production"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
