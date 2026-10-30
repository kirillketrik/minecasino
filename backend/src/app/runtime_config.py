"""Settings an admin can change while the app runs.

What is configurable: the win-banner thresholds (in bets), and per game which play modes are
switched off and a lower maximum bet. For slots also the RTP and the win cap, within the bounds
below (see `app.games.base.Tuning` for how they are applied). Stored as one JSON row; a missing
row means the defaults.
"""

from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.games.base import Game, Tuning
from app.games.slot import SlotGame
from app.models import AppConfig

KEY = "runtime"
# "Хороший", "Крупный", "Огромный", "Мега", "Максимальный": win / bet needed for each banner.
DEFAULT_WIN_TIERS = [10, 20, 40, 70, 100]
TIER_COUNT = len(DEFAULT_WIN_TIERS)
# Bounds an admin may set per slot.
MIN_RTP, MAX_RTP = 0.50, 0.99
MIN_MAX_WIN, MAX_MAX_WIN = 10, 5000


class GameConfig(BaseModel):
    disabled_modes: list[str] = []
    # Lower than the global maximum bet; None keeps the global one.
    max_bet: int | None = Field(None, ge=1)
    # Slots only: RTP as a fraction (0.96 = 96%) and the win cap in bets. None keeps the default.
    rtp: float | None = Field(None, ge=MIN_RTP, le=MAX_RTP)
    max_win: int | None = Field(None, ge=MIN_MAX_WIN, le=MAX_MAX_WIN)


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

    def tuning(self, game: Game, default_max_win: int) -> Tuning:
        """The knobs a slot is played with: this config over the calibrated game."""
        config = self.game(game.id)
        return Tuning(
            max_win=config.max_win or default_max_win,
            rtp_factor=config.rtp / game.target_rtp if config.rtp else 1.0,
        )

    def max_win(self, game: Game, default: int) -> int:
        return self.game(game.id).max_win or default if isinstance(game, SlotGame) else default


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
