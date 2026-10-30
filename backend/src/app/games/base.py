"""The contract every game implements.

A game is a pure state machine: it never touches the database or the wallet. `start` opens a
round and `act` advances an unfinished one. Single-spin slots finish inside `start`; crash and
gamble-style games stay open until a later `act`. The engine (`engine.finalize`) applies the
win cap to every result, so a game cannot pay out more than the cap even if its math is wrong.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from math import ceil
from typing import Any, ClassVar

from app.games.rng import Rng

# Return to player every game is tuned for unless it states otherwise.
TARGET_RTP = 0.96
# A round never pays more than bet * MAX_WIN_MULTIPLIER (enforced in engine.finalize).
MAX_WIN_MULTIPLIER = 100


class InvalidAction(Exception):
    """The action is unknown or not allowed in the round's current state."""


@dataclass(frozen=True)
class GameResult:
    bet: int
    # Total coins to credit for the round. Only paid out once `finished`; 0 until then.
    payout: int
    finished: bool
    # Private server-side state, persisted with the round. Never sent to the client.
    state: dict[str, Any] = field(default_factory=dict)
    # Public data the client may see (reels, cluster map, current multiplier...).
    view: dict[str, Any] = field(default_factory=dict)


class Game(ABC):
    id: ClassVar[str]
    # Long-run return to player the game is tuned for, checked by simulation tests.
    target_rtp: ClassVar[float] = TARGET_RTP
    # Bets must be in [min_bet, max_bet from settings] and a multiple of bet_step.
    min_bet: ClassVar[int] = 1
    bet_step: ClassVar[int] = 1

    # Optional play modes (buy bonus, guaranteed scatter...): mode id -> cost in 1/20 of the bet.
    modes: ClassVar[dict[str, int]] = {}

    def cost(self, bet: int, mode: str | None) -> int:
        """Coins debited for a round. The win cap and `bet` itself always refer to the base bet."""
        if mode is None:
            return bet
        if mode not in self.modes:
            raise InvalidAction(f"unknown mode '{mode}'")
        return bet // 20 * self.modes[mode]

    @abstractmethod
    def start(self, bet: int, rng: Rng, mode: str | None = None) -> GameResult: ...

    def act(self, state: dict[str, Any], bet: int, action: dict[str, Any], rng: Rng) -> GameResult:
        raise InvalidAction(f"{self.id} has no actions")

    def abandon(self, state: dict[str, Any], bet: int, rng: Rng) -> GameResult | None:
        """Close a round the player walked away from (e.g. started another one).

        Return the finished result to settle it, or None if the round must stay open.
        """
        return None


@dataclass(frozen=True)
class Tuning:
    """Admin-set knobs of a slot, applied on top of its calibrated maths.

    `rtp_factor` scales every pay (RTP is linear in the pays); `max_win` is this game's win cap in
    bets. The defaults are the calibrated game: 96% and the global cap.
    """

    max_win: int = MAX_WIN_MULTIPLIER
    rtp_factor: float = 1.0

    def raw_cap_units(self, units_per_bet: int) -> int:
        """The win cap as the game itself counts it, before `rtp_factor` is applied."""
        return ceil(self.max_win * units_per_bet / self.rtp_factor)
