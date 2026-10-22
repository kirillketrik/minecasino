from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.games.base import MAX_WIN_MULTIPLIER


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="MINEBET_", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./minebet.db"
    jwt_secret: str = "dev-secret-change-me-dev-secret-change-me"
    jwt_ttl_minutes: int = 60 * 24
    cors_origins: list[str] = ["http://localhost:5173"]

    starting_balance: int = 1000
    min_bet: int = 1
    max_bet: int = 1000
    max_win_multiplier: int = MAX_WIN_MULTIPLIER

    # Payments are a stub in the MVP: deposit credits coins without a real gateway.
    payments_stub: bool = True
    stub_deposit_max: int = 10_000
    min_withdrawal: int = 100


@lru_cache
def get_settings() -> Settings:
    return Settings()
