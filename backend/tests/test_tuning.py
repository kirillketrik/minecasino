"""The admin knobs of a slot: RTP and win cap."""

import random

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.games import get_rng
from app.games import registry
from app.games.base import Tuning
from app.games.catalog import register_all
from app.games.ender import EnderGame
from app.games.rng import Rng, seeded_rng
from app.games.simulation import simulate
from app.games.slot import SlotGame, SpinOutcome, scale_win
from app.models import User


class Fixed(SlotGame):
    id = "fixed"

    def __init__(self, win: int) -> None:
        self.win = win

    def spin(self, unit: int, rng: Rng, mode: str | None, tuning: Tuning) -> SpinOutcome:
        return SpinOutcome(self.win * unit, {"cap_units": tuning.raw_cap_units(20)})


def test_scale_win_is_exact_for_whole_results_and_unbiased_otherwise():
    rng = seeded_rng(1)
    assert scale_win(10, 1.0, rng) == 10 and scale_win(0, 0.5, rng) == 0
    assert scale_win(10, 0.5, rng) == 5
    draws = [scale_win(7, 0.5, rng) for _ in range(20_000)]  # 3.5 -> 3 or 4
    assert set(draws) == {3, 4}
    assert abs(sum(draws) / len(draws) - 3.5) < 0.03


def test_rtp_factor_scales_the_payout_and_flags_it():
    result = Fixed(win=4).start(100, Rng(random.Random(1)), None, Tuning(rtp_factor=0.5))
    assert result.payout == 10 and result.view["rtp_scale"] == 0.5
    assert "rtp_scale" not in Fixed(win=4).start(100, Rng(random.Random(1))).view


def test_max_win_caps_the_scaled_payout():
    low = Fixed(win=10_000).start(100, Rng(random.Random(1)), None, Tuning(max_win=20))
    assert low.payout == 2_000 and low.view["capped"] is True
    high = Fixed(win=20_000).start(100, Rng(random.Random(1)), None, Tuning(max_win=500))
    assert high.payout == 50_000 and high.view["capped"] is True


def test_the_game_is_told_where_to_stop_in_its_own_units():
    assert Tuning(max_win=100, rtp_factor=0.5).raw_cap_units(20) == 4000
    assert Tuning(max_win=100).raw_cap_units(20) == 2000
    view = Fixed(win=1).start(100, Rng(random.Random(1)), None, Tuning(max_win=50)).view
    assert view["cap_units"] == 1000


@pytest.mark.parametrize("game_id", ["creeper", "ender"])
def test_rtp_follows_the_factor(game_id: str):
    register_all()
    game = registry.get_game(game_id)
    assert game is not None
    full = simulate(game, seeded_rng(5), 40_000, bet=100, tuning=Tuning())
    half = simulate(game, seeded_rng(5), 40_000, bet=100, tuning=Tuning(rtp_factor=0.5))
    assert 0.35 < half.rtp / full.rtp < 0.65, (full, half)


def test_a_higher_cap_pays_more_than_100x():
    report = simulate(
        EnderGame(),
        seeded_rng(9),
        30_000,
        bet=100,
        max_multiplier=1000,
        tuning=Tuning(max_win=1000),
    )
    assert report.max_multiplier > 100


# --- through the API ---------------------------------------------------------------------------


async def _admin(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory() as session:
        await session.execute(update(User).values(is_admin=True))
        await session.commit()


async def test_admin_sets_rtp_and_win_cap_per_slot(
    client: AsyncClient, auth: dict[str, str], session_factory: async_sessionmaker[AsyncSession]
):
    await _admin(session_factory)
    catalog = (await client.get("/api/admin/config", headers=auth)).json()["games"]
    by_id = {g["id"]: g for g in catalog}
    assert by_id["ender"]["tunable"] and by_id["mines"]["tunable"] and by_id["creeper"]["tunable"]
    assert not by_id["elytra"]["tunable"]
    assert by_id["ender"]["default_rtp"] == 0.96 and by_id["ender"]["default_max_win"] == 100

    body = {"games": {"ender": {"rtp": 0.9, "max_win": 250}, "creeper": {"max_win": 40}}}
    r = await client.put("/api/admin/config", json=body, headers=auth)
    assert r.status_code == 200, r.text
    infos = {g["id"]: g for g in (await client.get("/api/games")).json()}
    assert infos["ender"]["max_win_multiplier"] == 250
    assert infos["creeper"]["max_win_multiplier"] == 40
    assert infos["mines"]["max_win_multiplier"] == 100
    assert infos["ender"]["rtp"] == 0.9 and infos["creeper"]["rtp"] == 0.96
    assert infos["elytra"]["rtp"] == 0.96


async def test_tuning_input_is_validated(
    client: AsyncClient, auth: dict[str, str], session_factory: async_sessionmaker[AsyncSession]
):
    await _admin(session_factory)
    for bad in (
        {"games": {"ender": {"rtp": 0.3}}},
        {"games": {"ender": {"rtp": 1.2}}},
        {"games": {"ender": {"max_win": 5}}},
        {"games": {"ender": {"max_win": 100_000}}},
        {"games": {"elytra": {"rtp": 0.9}}},  # not a slot
        {"games": {"elytra": {"max_win": 50}}},
    ):
        r = await client.put("/api/admin/config", json=bad, headers=auth)
        assert r.status_code == 422, bad


async def test_a_lowered_win_cap_is_enforced_on_real_rounds(
    app: FastAPI,
    client: AsyncClient,
    auth: dict[str, str],
    session_factory: async_sessionmaker[AsyncSession],
):
    await _admin(session_factory)
    r = await client.put(
        "/api/admin/config", json={"games": {"ender": {"max_win": 10}}}, headers=auth
    )
    assert r.status_code == 200, r.text
    app.dependency_overrides[get_rng] = lambda: seeded_rng(4)
    best = 0
    for _ in range(150):
        r = await client.post("/api/games/ender/rounds", json={"bet": 20}, headers=auth)
        assert r.status_code == 201
        best = max(best, r.json()["payout"])
    assert 0 < best <= 20 * 10


async def test_admin_can_measure_a_setting_before_saving_it(
    client: AsyncClient, auth: dict[str, str], session_factory: async_sessionmaker[AsyncSession]
):
    await _admin(session_factory)
    r = await client.post(
        "/api/admin/simulate",
        json={"game_id": "mines", "rtp": 0.8, "max_win": 50, "rounds": 2000},
        headers=auth,
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["rounds"] == 2000 and 0 < out["rtp"] < 1.2 and out["max_multiplier"] <= 50

    for bad in (
        {"game_id": "elytra"},  # not a slot
        {"game_id": "nope"},
        {"game_id": "ender", "rounds": 10},
        {"game_id": "ender", "rtp": 2},
    ):
        assert (await client.post("/api/admin/simulate", json=bad, headers=auth)).status_code == 422


async def test_simulation_is_admin_only(client: AsyncClient, auth: dict[str, str]):
    r = await client.post("/api/admin/simulate", json={"game_id": "ender"}, headers=auth)
    assert r.status_code == 403
