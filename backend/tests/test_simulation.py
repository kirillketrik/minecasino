"""RTP verification. Seeds are fixed, so these are deterministic; the z-limit of 4 means a game
whose true RTP is on target passes, and one that is off by even ~1.5 points does not."""

import pytest

from app.games.rng import seeded_rng
from app.games.simulation import simulate
from tests.fakes import FlipGame, JackpotGame, LadderGame

Z_LIMIT = 4.0


def test_flip_game_hits_target_rtp():
    game = FlipGame()
    report = simulate(game, seeded_rng(2024), 300_000)
    assert abs(report.z_score(game.target_rtp)) < Z_LIMIT, report
    assert report.hit_rate == pytest.approx(0.5, abs=0.01)
    assert report.max_multiplier == 1.92
    assert report.capped_rounds == 0


def test_simulation_detects_a_miscalibrated_game():
    # RTP 1.00 instead of 0.96: the harness must flag it, otherwise the test above proves nothing.
    game = FlipGame(multiplier=2.0)
    report = simulate(game, seeded_rng(2024), 300_000)
    assert abs(report.z_score(0.96)) > Z_LIMIT


def test_win_cap_bounds_every_round_and_costs_rtp():
    report = simulate(JackpotGame(), seeded_rng(5), 400_000, bet=10)
    assert report.max_multiplier == 100.0
    assert report.capped_rounds > 0
    # Uncapped it would be 0.96; capped at 100x instead of 1000x it is about 0.096.
    assert report.rtp == pytest.approx(0.096, abs=0.04)


def _collect_after_flips(limit: int):
    def policy(game, state, bet, rng):
        return {"type": "flip"} if state["pot"] < bet * 2**limit else {"type": "collect"}

    return policy


def test_open_rounds_are_played_out_by_policy_and_capped():
    # Doubling to 2**10 = 1024x then collecting must be clamped to 100x.
    report = simulate(
        LadderGame(), seeded_rng(9), 20_000, policy=_collect_after_flips(10), max_steps=50
    )
    assert report.max_multiplier <= 100.0
    assert report.capped_rounds > 0


def test_ladder_with_fair_flips_keeps_rtp_near_one_when_uncapped_range():
    # One fair double-or-nothing flip: EV is exactly 1.0 (no house edge in this fake).
    report = simulate(LadderGame(), seeded_rng(11), 200_000, policy=_collect_after_flips(1))
    assert abs(report.z_score(1.0)) < Z_LIMIT


def test_open_round_without_policy_is_an_error():
    with pytest.raises(RuntimeError):
        simulate(LadderGame(), seeded_rng(1), 1)
