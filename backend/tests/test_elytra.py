import asyncio
import math
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.games import get_rng
from app.api.ws import get_session_factory
from app.db import Base, get_session
from app.games import elytra as E
from app.games.base import InvalidAction
from app.games.engine import finalize
from app.games.rng import seeded_rng
from app.games.simulation import simulate
from app.main import create_app
from app.models import Round

from .conftest import REGISTER


class Clock:
    def __init__(self, now: float = 1000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


def open_round(crash: int, bet: int = 100) -> tuple[E.ElytraGame, Clock, dict]:
    clock = Clock()
    game = E.ElytraGame(clock)
    state = {"crash": crash, "started_at": clock.now}
    return game, clock, state


CASHOUT = {"type": "cashout"}


# --- the curve and the crash point -------------------------------------------------------------


def test_multiplier_curve():
    assert E.multiplier_at(-1) == 100 and E.multiplier_at(0) == 100
    assert E.multiplier_at(math.log(2) / E.GROWTH + 1e-6) == 200
    assert E.multiplier_at(1e6) == E.CAP


def test_time_to_inverts_the_curve():
    for m in (101, 150, 200, 777, 5000, E.CAP):
        assert E.multiplier_at(E.time_to(m) + 1e-6) == m
        assert E.multiplier_at(E.time_to(m) - 1e-3) < m


def test_every_cashout_target_returns_exactly_96_percent():
    """P(crash >= m) is computed exactly from the integer draw, for every possible target."""
    for m in range(E.MIN_CASHOUT, E.CAP + 1):
        expected = m / 100 * E.win_probability(m)
        assert abs(expected - 0.96) < 1e-12, m


def test_crash_point_distribution_matches_the_formula():
    rng = seeded_rng(5)
    n = 200_000
    points = [E.draw_crash_point(rng) for _ in range(n)]
    assert max(points) <= E.CAP
    for m in (100, 150, 200, 500, 1000, 5000):
        freq = sum(p >= m for p in points) / n
        p = E.win_probability(m)
        assert abs(freq - p) < 4 * math.sqrt(p * (1 - p) / n), m
    assert abs(sum(p < 100 for p in points) / n - 0.04) < 0.003  # instant busts


def test_cap_mass():
    rng = seeded_rng(6)
    n = 400_000
    at_cap = sum(E.draw_crash_point(rng) == E.CAP for _ in range(n)) / n
    assert abs(at_cap - 0.0096) < 0.0006


# --- the state machine -------------------------------------------------------------------------


def test_start_hides_the_crash_point():
    result = E.ElytraGame(Clock()).start(100, seeded_rng(1))
    if not result.finished:
        assert "crash" in result.state
        assert "crash_point" not in result.view and "crash" not in result.view
        assert result.view["status"] == "flying" and result.payout == 0


def test_instant_crash_finishes_at_once():
    # r = 0 gives the smallest crash point: 0.96x, below the 1.00x take-off.
    class Rng:
        def randbelow(self, n):
            return 0

    result = E.ElytraGame(Clock()).start(100, Rng())  # type: ignore[arg-type]
    assert result.finished and result.payout == 0 and result.view["status"] == "crashed"
    assert result.view["crash_point"] == 96


def test_cashout_pays_the_multiplier_floor():
    game, clock, state = open_round(crash=10000)
    clock.now += E.time_to(250) + 1e-6
    r = game.act(state, 101, CASHOUT, seeded_rng(1))
    assert r.finished and r.view["status"] == "cashed_out" and r.view["cashout"] == 250
    assert r.payout == 101 * 250 // 100 == 252
    assert r.view["crash_point"] == 10000


def test_cashout_after_the_crash_pays_nothing():
    game, clock, state = open_round(crash=200)
    clock.now += E.time_to(201) + 0.01  # just past the crash
    r = game.act(state, 100, CASHOUT, seeded_rng(1))
    assert r.finished and r.payout == 0 and r.view["status"] == "crashed"


def test_cashout_exactly_at_the_crash_point_wins():
    game, clock, state = open_round(crash=200)
    clock.now += E.time_to(200) + 1e-6
    assert game.current_multiplier(state) == 200
    assert game.act(state, 100, CASHOUT, seeded_rng(1)).payout == 200


def test_cashout_before_one_oh_one_is_refused_and_does_not_end_the_round():
    game, clock, state = open_round(crash=10000)
    with pytest.raises(InvalidAction):
        game.act(state, 100, CASHOUT, seeded_rng(1))
    clock.now += E.time_to(101) + 1e-6
    assert game.act(state, 100, CASHOUT, seeded_rng(1)).payout == 101


def test_unknown_action():
    game, _, state = open_round(crash=500)
    with pytest.raises(InvalidAction):
        game.act(state, 100, {"type": "boost"}, seeded_rng(1))


def test_hundred_x_cap_pays_the_cap_even_late():
    game, clock, state = open_round(crash=E.CAP)
    clock.now += 10_000
    r = game.act(state, 100, CASHOUT, seeded_rng(1))
    assert r.payout == 100 * 100 and r.view["cashout"] == E.CAP


def test_late_cashout_below_the_cap_crash_is_a_bust():
    game, clock, state = open_round(crash=E.CAP - 1)
    clock.now += 10_000
    assert game.act(state, 100, CASHOUT, seeded_rng(1)).payout == 0


def test_abandon_forfeits_unless_the_cap_was_reached():
    game, clock, state = open_round(crash=5000)
    assert game.abandon(state, 100, seeded_rng(1)).payout == 0
    game, clock, state = open_round(crash=E.CAP)
    assert game.abandon(state, 100, seeded_rng(1)).payout == 0  # still flying
    clock.now += 100
    assert game.abandon(state, 100, seeded_rng(1)).payout == 100 * 100


def test_settle_at():
    game, clock, state = open_round(crash=200)
    assert game.settle_at(state) == pytest.approx(clock.now + E.time_to(201))
    game, clock, state = open_round(crash=E.CAP)
    assert game.settle_at(state) == pytest.approx(clock.now + E.time_to(E.CAP))


def test_finalize_never_exceeds_the_cap():
    game, clock, state = open_round(crash=E.CAP)
    clock.now += 1000
    raw = game.act(state, 1000, CASHOUT, seeded_rng(1))
    assert finalize(raw, 100).payout == 100_000


# --- RTP by simulation, any strategy -----------------------------------------------------------


def target_policy(target: int):
    def policy(game, state, bet, rng):
        game._clock.now = state["started_at"] + E.time_to(target) + 1e-6
        return CASHOUT

    return policy


@pytest.mark.parametrize("target", [101, 150, 200, 1000, E.CAP])
def test_simulated_rtp_is_96_whatever_the_strategy(target):
    clock = Clock()
    game = E.ElytraGame(clock)
    report = simulate(game, seeded_rng(target), 100_000, bet=1000, policy=target_policy(target))
    assert abs(report.z_score(0.96)) < 4, report
    assert report.max_multiplier <= 100


def test_never_cashing_out_is_96_too():
    clock = Clock()
    game = E.ElytraGame(clock)

    def hold_forever(game, state, bet, rng):
        game._clock.now = state["started_at"] + 1e6
        return CASHOUT

    report = simulate(game, seeded_rng(9), 600_000, bet=100, policy=hold_forever)
    assert abs(report.z_score(0.96)) < 4, report


# --- API: the existing round endpoints work for the game ----------------------------------------


async def test_listed(client: AsyncClient):
    games = {g["id"]: g for g in (await client.get("/api/games")).json()}
    assert "elytra" in games and games["elytra"]["bet_step"] == 1


async def test_flight_over_http(
    app: FastAPI, client: AsyncClient, auth: dict[str, str], session_factory
):
    # Find a seed whose first round flies (96% of them do).
    app.dependency_overrides[get_rng] = lambda: seeded_rng(4)
    r = await client.post("/api/games/elytra/rounds", json={"bet": 200}, headers=auth)
    assert r.status_code == 201
    body = r.json()
    if body["finished"]:
        pytest.skip("seed gave an instant crash")
    assert body["balance"] == 1_000 - 200
    assert body["view"]["status"] == "flying" and "crash_point" not in body["view"]

    async with session_factory() as s:
        rnd = await s.get(Round, body["id"])
        assert rnd is not None
        rnd.state = {"crash": 10_000, "started_at": time.time() - E.time_to(300) - 0.05}
        await s.commit()

    bal = body["balance"]
    r = await client.post(
        f"/api/rounds/{body['id']}/actions", json={"action": CASHOUT}, headers=auth
    )
    assert r.status_code == 200
    out = r.json()
    assert out["finished"] and out["view"]["status"] == "cashed_out"
    assert out["view"]["cashout"] >= 300 and out["payout"] == 200 * out["view"]["cashout"] // 100
    assert out["balance"] == bal + out["payout"]
    again = await client.post(
        f"/api/rounds/{body['id']}/actions", json={"action": CASHOUT}, headers=auth
    )
    assert again.status_code == 409


async def test_starting_another_round_forfeits_a_live_flight(
    app: FastAPI, client: AsyncClient, auth: dict[str, str], session_factory
):
    app.dependency_overrides[get_rng] = lambda: seeded_rng(4)
    first = (await client.post("/api/games/elytra/rounds", json={"bet": 100}, headers=auth)).json()
    if first["finished"]:
        pytest.skip("seed gave an instant crash")
    await client.post("/api/games/elytra/rounds", json={"bet": 100}, headers=auth)
    async with session_factory() as s:
        rnd = await s.get(Round, first["id"])
        assert rnd is not None and rnd.finished and rnd.payout == 0


# --- WebSocket ---------------------------------------------------------------------------------


@pytest.fixture
def live(tmp_path: Path) -> Iterator[tuple[TestClient, async_sessionmaker, dict[str, str]]]:
    url = f"sqlite+aiosqlite:///{tmp_path / 'ws.db'}"

    async def init() -> None:
        engine = create_async_engine(url)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await engine.dispose()

    asyncio.run(init())
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    app = create_app()

    async def session_override():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[get_session_factory] = lambda: factory
    # Instant crashes are 4%: pick a seed whose first draw is a real flight.
    app.dependency_overrides[get_rng] = lambda: seeded_rng(4)

    with TestClient(app) as client:
        token = client.post("/api/auth/register", json=REGISTER).json()["access_token"]
        yield client, factory, {"Authorization": f"Bearer {token}"}
    asyncio.run(engine.dispose())


def start_flight(client: TestClient, factory, headers, *, crash: int, started_in: float = 0.0):
    r = client.post("/api/games/elytra/rounds", json={"bet": 100}, headers=headers)
    assert r.status_code == 201
    rid = r.json()["id"]
    assert not r.json()["finished"]

    async def rewrite() -> None:
        async with factory() as s:
            rnd = await s.get(Round, rid)
            assert rnd is not None
            rnd.state = {"crash": crash, "started_at": time.time() + started_in}
            await s.commit()

    asyncio.run(rewrite())
    return rid


def test_ws_rejects_a_bad_token(live):
    client, _, headers = live
    with client.websocket_connect("/api/ws/rounds/1") as ws:
        ws.send_json({"token": "nope"})
        with pytest.raises(Exception) as info:
            ws.receive_json()
        assert getattr(info.value, "code", None) == 4401


def test_ws_streams_ticks_and_cashes_out(live):
    client, factory, headers = live
    rid = start_flight(client, factory, headers, crash=10_000)
    token = headers["Authorization"].split()[1]
    with client.websocket_connect(f"/api/ws/rounds/{rid}") as ws:
        ws.send_json({"token": token})
        ticks = [ws.receive_json() for _ in range(4)]
        assert all(t["type"] == "tick" for t in ticks)
        assert ticks[-1]["multiplier"] >= ticks[0]["multiplier"] >= 100
        ws.send_json({"action": "cashout"})
        end = ws.receive_json()
        while end["type"] == "tick":
            end = ws.receive_json()
    assert end["type"] == "end" and end["status"] == "cashed_out"
    assert end["view"]["cashout"] >= 101
    assert end["payout"] == 100 * end["view"]["cashout"] // 100
    assert end["balance"] == 1_000 - 100 + end["payout"]


def test_ws_settles_a_crash_by_itself(live):
    client, factory, headers = live
    rid = start_flight(client, factory, headers, crash=101)
    token = headers["Authorization"].split()[1]
    with client.websocket_connect(f"/api/ws/rounds/{rid}") as ws:
        ws.send_json({"token": token})
        msg = ws.receive_json()
        while msg["type"] == "tick":
            assert msg["multiplier"] <= 101
            msg = ws.receive_json()
    assert msg["type"] == "end" and msg["status"] == "crashed" and msg["payout"] == 0
    assert msg["view"]["crash_point"] == 101
    assert msg["balance"] == 1_000 - 100


def test_ws_refuses_an_early_cashout_and_keeps_flying(live):
    client, factory, headers = live
    rid = start_flight(client, factory, headers, crash=10_000, started_in=30.0)
    token = headers["Authorization"].split()[1]
    with client.websocket_connect(f"/api/ws/rounds/{rid}") as ws:
        ws.send_json({"token": token})
        assert ws.receive_json()["type"] == "tick"
        ws.send_json({"action": "cashout"})
        msg = ws.receive_json()
        while msg["type"] == "tick":
            msg = ws.receive_json()
        assert msg["type"] == "error"
        assert ws.receive_json()["type"] == "tick"  # still flying


def test_ws_reports_a_finished_round_at_once(live):
    client, factory, headers = live
    rid = start_flight(client, factory, headers, crash=10_000, started_in=-100.0)
    client.post(f"/api/rounds/{rid}/actions", json={"action": CASHOUT}, headers=headers)
    token = headers["Authorization"].split()[1]
    with client.websocket_connect(f"/api/ws/rounds/{rid}") as ws:
        ws.send_json({"token": token})
        end = ws.receive_json()
    assert end["type"] == "end" and end["status"] == "cashed_out" and end["payout"] == 10_000
