"""Shared skeleton of the paid-spin slots (Шахта, Крипер, Врата Края).

A slot subclass only says how one spin plays out: `spin` returns the raw win in coins and the
public view. Everything around it lives here once: validating the play mode, the price, the admin
`Tuning` (RTP factor and win cap), the `total_win` / `mode` / `cost` / `capped` fields of the view
and building the result.

Wins are whole multiples of `bet / units_per_bet`, so `bet` must be a multiple of `units_per_bet`.
Scaling a win by the RTP factor can leave a fraction of a coin; it is rounded at random with the
fraction as the odds, so the expected pay is exactly the scaled one and nothing is lost to rounding.
A slot that keeps the round open after a win (Шахта's gamble) overrides `settle`.
"""

from abc import abstractmethod
from dataclasses import dataclass, field
from math import floor
from typing import Any, ClassVar

from app.games.base import Game, GameResult, Tuning
from app.games.engine import cap_payout
from app.games.rng import Rng


@dataclass(frozen=True)
class SpinOutcome:
    # Everything the spin won, before the RTP factor and the cap, in coins.
    raw_win: int
    # Public data of the spin; the base class adds total_win, mode, cost and capped.
    view: dict[str, Any] = field(default_factory=dict)


def scale_win(raw_win: int, factor: float, rng: Rng) -> int:
    """`raw_win * factor` in whole coins, rounded at random so the expectation stays exact."""
    if factor == 1.0 or raw_win == 0:
        return raw_win
    scaled = raw_win * factor
    whole = floor(scaled)
    return whole + (rng.random() < scaled - whole)


class SlotGame(Game):
    # A bet is split into this many equal units (lines, or pay units of a cluster slot).
    units_per_bet: ClassVar[int] = 20
    min_bet: ClassVar[int] = units_per_bet
    bet_step: ClassVar[int] = units_per_bet

    @abstractmethod
    def spin(self, unit: int, rng: Rng, mode: str | None, tuning: Tuning) -> SpinOutcome:
        """Play the whole spin (free spins and cascades included). `unit` is bet / units_per_bet.

        `tuning.raw_cap_units` tells a game that stops early at the cap where to stop.
        """

    def settle(self, bet: int, payout: int, view: dict[str, Any], tuning: Tuning) -> GameResult:
        """Turn the capped payout into a result. Single-spin slots finish at once."""
        return GameResult(bet=bet, payout=payout, finished=True, view=view)

    def start(
        self, bet: int, rng: Rng, mode: str | None = None, tuning: Tuning | None = None
    ) -> GameResult:
        tuning = tuning or Tuning()
        cost = self.cost(bet, mode)  # rejects an unknown mode before anything is drawn
        outcome = self.spin(bet // self.units_per_bet, rng, mode, tuning)
        scaled = scale_win(outcome.raw_win, tuning.rtp_factor, rng)
        payout = cap_payout(bet, scaled, tuning.max_win)
        view = {**outcome.view, "total_win": payout, "mode": mode, "cost": cost}
        if scaled > payout:
            view["capped"] = True
        if tuning.rtp_factor != 1.0:
            view["rtp_scale"] = tuning.rtp_factor  # per-line numbers in the view are unscaled
        return self.settle(bet, payout, view, tuning)
