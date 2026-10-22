import math

import pytest

from app.games.base import GameResult
from app.games.engine import cap_payout, finalize
from app.games.rng import WeightedTable, seeded_rng


def test_seeded_rng_is_deterministic():
    a, b = seeded_rng(7), seeded_rng(7)
    assert [a.random() for _ in range(5)] == [b.random() for _ in range(5)]
    assert seeded_rng(7).random() != seeded_rng(8).random()


def test_randbelow_stays_in_range_and_covers_it():
    rng = seeded_rng(1)
    draws = {rng.randbelow(6) for _ in range(500)}
    assert draws == {0, 1, 2, 3, 4, 5}


def test_weighted_table_matches_weights():
    weights = [60, 25, 10, 5]
    table = WeightedTable(["coal", "iron", "gold", "diamond"], weights)
    rng = seeded_rng(42)
    n = 200_000
    counts = dict.fromkeys(table.items, 0)
    for _ in range(n):
        counts[table.draw(rng)] += 1
    for item, w in zip(table.items, weights, strict=True):
        p = w / 100
        sigma = math.sqrt(p * (1 - p) / n)
        assert abs(counts[item] / n - p) < 4 * sigma, item
    assert table.probability("gold") == 0.10


def test_weighted_index_skips_zero_weights():
    rng = seeded_rng(3)
    assert {rng.weighted_index([0, 5, 0, 5]) for _ in range(300)} == {1, 3}


@pytest.mark.parametrize(
    ("items", "weights"), [([], []), (["a"], [1, 2]), (["a"], [0]), (["a", "b"], [1, -1])]
)
def test_weighted_table_rejects_bad_input(items, weights):
    with pytest.raises(ValueError):
        WeightedTable(items, weights)


@pytest.mark.parametrize(
    ("bet", "payout", "expected"),
    [
        (10, 0, 0),
        (10, 999, 999),
        (10, 1000, 1000),
        (10, 1001, 1000),
        (10, 10**9, 1000),
        (10, -5, 0),
    ],
)
def test_cap_payout(bet, payout, expected):
    assert cap_payout(bet, payout, 100) == expected


def test_finalize_caps_finished_rounds_and_flags_it():
    raw = GameResult(bet=10, payout=5000, finished=True, view={"x": 1})
    out = finalize(raw, 100)
    assert out.payout == 1000
    assert out.view == {"x": 1, "capped": True}


def test_finalize_leaves_legal_payouts_untouched():
    raw = GameResult(bet=10, payout=1000, finished=True)
    assert finalize(raw, 100) is raw


def test_finalize_never_pays_an_open_round():
    raw = GameResult(bet=10, payout=500, finished=False)
    assert finalize(raw, 100).payout == 0
