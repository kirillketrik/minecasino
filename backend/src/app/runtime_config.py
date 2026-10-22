"""Settings an admin can change while the app runs. They never touch the maths of a game.

What is configurable: the win-banner thresholds (in bets), and per game which play modes are
switched off and a lower maximum bet. Stored as one JSON row; a missing row means the defaults.
"""

from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppConfig

KEY = "runtime"
# "Хороший", "Крупный", "Огромный", "Мега", "Максимальный": win / bet needed for each banner.
DEFAULT_WIN_TIERS = [10, 20, 40, 70, 100]
TIER_COUNT = len(DEFAULT_WIN_TIERS)


class GameConfig(BaseModel):
    disabled_modes: list[str] = []
    # Lower than the global maximum bet; None keeps the global one.
    max_bet: int | None = Field(None, ge=1)


class RuntimeConfig(BaseModel):
    win_tiers: list[int] = list(DEFAULT_WIN_TIERS)
    games: dict[str, GameConfig] = {}

    @field_validator("win_tiers")
    @classmethod
    def _tiers(cls, tiers: list[int]) -> list[int]:
        if len(tiers) != TIER_COUNT:
            raise ValueError(f"exactly {TIER_COUNT} thresholds are needed")
        if any(not 1 <= t <= 100 for t in tiers):
            raise ValueError("thresholds must be between 1 and 100 bets")
        if any(a >= b for a, b in zip(tiers, tiers[1:], strict=False)):
            raise ValueError("thresholds must grow from one banner to the next")
        return tiers

    def game(self, game_id: str) -> GameConfig:
        return self.games.get(game_id, GameConfig())


async def load(session: AsyncSession) -> RuntimeConfig:
    row = await session.get(AppConfig, KEY)
    return RuntimeConfig.model_validate(row.value) if row else RuntimeConfig()


async def save(session: AsyncSession, config: RuntimeConfig) -> None:
    value = config.model_dump()
    row = await session.get(AppConfig, KEY)
    if row is None:
        session.add(AppConfig(key=KEY, value=value))
    else:
        row.value = value
