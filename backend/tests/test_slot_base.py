"""SlotGame: the shared start() flow, checked on a stub slot with a fixed win."""

import random

import pytest

from app.games.base import MAX_WIN_MULTIPLIER, InvalidAction
from app.games.rng import Rng
from app.games.slot import SlotGame, SpinOutcome


class Stub(SlotGame):
    id = "stub"
    modes = {"pricey": 30}

    def __init__(self, win: int) -> None:
        self.win = win

    def spin(self, unit: int, rng: Rng, mode: str | None) -> SpinOutcome:
        return SpinOutcome(self.win * unit, {"unit": unit})


def test_view_gets_total_cost_and_mode():
    result = Stub(win=3).start(100, Rng(random.Random(1)), "pricey")
    assert result.finished and result.payout == 15
    assert result.view == {"unit": 5, "total_win": 15, "mode": "pricey", "cost": 150}


def test_plain_spin_costs_the_bet():
    result = Stub(win=0).start(100, Rng(random.Random(1)))
    assert result.payout == 0 and result.view["cost"] == 100 and result.view["mode"] is None


def test_win_is_capped_and_flagged():
    result = Stub(win=10_000).start(100, Rng(random.Random(1)))
    assert result.payout == 100 * MAX_WIN_MULTIPLIER
    assert result.view["capped"] is True


def test_unknown_mode_is_rejected_before_spinning():
    with pytest.raises(InvalidAction):
        Stub(win=1).start(100, Rng(random.Random(1)), "nope")
