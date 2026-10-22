"""Shared skeleton of the paid-spin slots (Шахта, Крипер).

A slot subclass only says how one spin plays out: `spin` returns the raw win in coins and the
public view. Everything around it lives here once: validating the play mode, the price, the win
cap, the `total_win` / `mode` / `cost` / `capped` fields of the view and building the result.

Wins are whole multiples of `bet / units_per_bet`, so `bet` must be a multiple of `units_per_bet`
and payouts need no rounding. A slot that keeps the round open after a win (Шахта's gamble)
overrides `settle`.
"""

from abc import abstractmethod
from dataclasses import dataclass, field
from typing import Any, ClassVar

from app.games.base import MAX_WIN_MULTIPLIER, Game, GameResult
from app.games.engine import cap_payout
from app.games.rng import Rng


@dataclass(frozen=True)
class SpinOutcome:
    # Everything the spin won, before the cap, in coins.
    raw_win: int
    # Public data of the spin; the base class adds total_win, mode, cost and capped.
    view: dict[str, Any] = field(default_factory=dict)


class SlotGame(Game):
    # A bet is split into this many equal units (lines, or pay units of a cluster slot).
    units_per_bet: ClassVar[int] = 20
    min_bet: ClassVar[int] = units_per_bet
    bet_step: ClassVar[int] = units_per_bet

    @abstractmethod
    def spin(self, unit: int, rng: Rng, mode: str | None) -> SpinOutcome:
        """Play the whole spin (free spins and cascades included). `unit` is bet / units_per_bet."""

    def settle(self, bet: int, payout: int, view: dict[str, Any]) -> GameResult:
        """Turn the capped payout into a result. Single-spin slots finish at once."""
        return GameResult(bet=bet, payout=payout, finished=True, view=view)

    def start(self, bet: int, rng: Rng, mode: str | None = None) -> GameResult:
        cost = self.cost(bet, mode)  # rejects an unknown mode before anything is drawn
        outcome = self.spin(bet // self.units_per_bet, rng, mode)
        payout = cap_payout(bet, outcome.raw_win, MAX_WIN_MULTIPLIER)
        view = {**outcome.view, "total_win": payout, "mode": mode, "cost": cost}
        if outcome.raw_win > payout:
            view["capped"] = True
        return self.settle(bet, payout, view)
