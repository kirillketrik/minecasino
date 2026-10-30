import itertools
from math import comb, prod

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.games import mines, registry
from app.games.base import InvalidAction
from app.games.mines import (
    COAL,
    DIAMOND,
    DYNAMITE,
    FREE_SPIN_MULTIPLIERS,
    IRON,
    LINES,
    PICKAXE,
    MinesGame,
    count_symbol,
    evaluate,
    line_win,
    theoretical_rtp,
)
from app.games.rng import seeded_rng
from app.games.simulation import simulate


def full(symbol: str) -> mines.Grid:
    return [[symbol] * 3 for _ in range(5)]


def blank() -> mines.Grid:
    """Alternating full columns: no line can ever make three in a row."""
    return [[COAL if r % 2 == 0 else IRON] * 3 for r in range(5)]


def with_scatters(n: int = 3) -> mines.Grid:
    grid = blank()
    for reel in range(n):
        grid[reel][0] = DYNAMITE
    return grid


class Scripted(MinesGame):
    """Plays prepared grids in order instead of drawing them."""

    id = "mines_test"

    def __init__(self, *grids: mines.Grid) -> None:
        super().__init__()
        self._grids = iter(grids)

    def _draw_grid(self, rng, min_scatters=0):
        return next(self._grids)


class Picks:
    """Crystal colours the 'rng' will produce: 0 is red, 1 is blue."""

    def __init__(self, *picks: int) -> None:
        self._picks = iter(picks)

    def randbelow(self, n: int) -> int:
        return next(self._picks)


# --- layout and evaluation ---------------------------------------------------------------------


def test_twenty_distinct_valid_lines():
    assert len(LINES) == 20 == len(set(LINES))
    assert all(len(line) == 5 and all(0 <= row <= 2 for row in line) for line in LINES)


@pytest.mark.parametrize(
    ("symbols", "expected"),
    [
        ([COAL, COAL, COAL, IRON, IRON], (COAL, 3)),
        ([COAL, PICKAXE, COAL, COAL, IRON], (COAL, 4)),
        ([COAL, PICKAXE, PICKAXE, PICKAXE, PICKAXE], (COAL, 5)),
        ([COAL, COAL, PICKAXE, IRON, COAL], (COAL, 3)),
        ([COAL, COAL, IRON, COAL, COAL], None),
        ([COAL, PICKAXE, IRON, IRON, IRON], None),
        ([COAL, COAL, DYNAMITE, COAL, COAL], None),
        ([COAL, PICKAXE, DYNAMITE, COAL, COAL], None),
        ([DYNAMITE, COAL, COAL, COAL, COAL], None),
        ([PICKAXE, PICKAXE, PICKAXE, PICKAXE, PICKAXE], (DIAMOND, 5)),
    ],
)
def test_line_win(symbols, expected):
    assert line_win(symbols) == expected


def test_all_coal_pays_every_line_five_of_a_kind():
    wins = evaluate(full(COAL))
    assert len(wins) == 20
    assert {(w.symbol, w.count, w.units) for w in wins} == {(COAL, 5, mines.PAYTABLE[COAL][5])}


def test_blank_grid_pays_nothing():
    assert evaluate(blank()) == []
    assert count_symbol(with_scatters(3), DYNAMITE) == 3


# --- exact maths against brute force -----------------------------------------------------------


def test_line_expectation_matches_full_enumeration():
    """Enumerate every 5-symbol line with its probability and pay it with the real rules."""
    reels = []
    for weights in mines.REEL_WEIGHTS:
        total = sum(weights.values())
        reels.append([(sym, w / total) for sym, w in weights.items()])

    expected = 0.0
    for combo in itertools.product(*reels):
        hit = line_win([sym for sym, _ in combo])
        if hit:
            expected += prod(p for _, p in combo) * mines.PAYTABLE[hit[0]][hit[1]]
    assert mines.line_expectation() == pytest.approx(expected, rel=1e-12)


def test_trigger_probability_matches_enumeration():
    p = [w[DYNAMITE] / sum(w.values()) for w in mines.REEL_WEIGHTS]
    total = 0.0
    for counts in itertools.product(range(4), repeat=5):
        if sum(counts) >= 3:
            total += prod(
                comb(3, c) * pr**c * (1 - pr) ** (3 - c) for c, pr in zip(counts, p, strict=True)
            )
    assert mines.trigger_probability() == pytest.approx(total, rel=1e-12)


def test_free_spin_multipliers_ramp_from_2_to_10():
    assert FREE_SPIN_MULTIPLIERS == (2, 3, 4, 5, 6, 7, 8, 9, 10, 10)


def test_theoretical_rtp_is_calibrated():
    # Uncapped RTP sits just above 96%; the 100x cap costs about 0.36 points (scripts/calibrate_mines.py).
    assert 0.9625 <= theoretical_rtp() <= 0.9645


def test_simulated_rtp_matches_target():
    game = MinesGame()
    report = simulate(
        game,
        seeded_rng(77),
        120_000,
        bet=100,
        policy=lambda g, state, bet, rng: {"type": "collect"},
    )
    assert abs(report.z_score(game.target_rtp)) < 4, report
    assert report.max_multiplier <= 100


# --- start: spins, free spins, cap -------------------------------------------------------------


def test_losing_spin_finishes_immediately():
    result = Scripted(blank()).start(100, None)
    assert result.finished and result.payout == 0
    assert result.view["wins"] == [] and result.view["free_spins"] is None


def test_winning_spin_stays_open_with_pot():
    result = Scripted(full(COAL)).start(20, None)  # line bet 1, 20 lines x 15
    assert not result.finished
    assert result.state["pot"] == 300
    assert result.view["pending"] == 300 and result.view["can_gamble"] is True
    assert len(result.view["wins"]) == 20


def test_three_scatters_trigger_ten_free_spins_with_rising_multiplier():
    result = Scripted(with_scatters(3), *[full(COAL)] * 10).start(20, None)
    spins = result.view["free_spins"]
    assert [s["multiplier"] for s in spins] == list(FREE_SPIN_MULTIPLIERS)
    assert [s["win"] for s in spins] == [300 * m for m in FREE_SPIN_MULTIPLIERS]
    assert result.view["base_win"] == 0


def test_two_scatters_do_not_trigger():
    result = Scripted(with_scatters(2)).start(20, None)
    assert result.view["free_spins"] is None


def test_round_win_is_capped_at_100x_including_free_spins():
    # Uncapped this is 19200 on a bet of 20; the cap is 2000.
    result = Scripted(with_scatters(3), *[full(COAL)] * 10).start(20, None)
    assert result.state["pot"] == 2000
    assert result.view["capped"] is True and result.view["total_win"] == 2000
    assert result.view["can_gamble"] is False


def test_bet_must_be_multiple_of_twenty():
    game = MinesGame()
    assert game.min_bet == game.bet_step == 20


# --- gamble, collect, abandon ------------------------------------------------------------------


def open_round(bet: int = 20, grid=None):
    game = Scripted(grid or full(COAL))
    return game, game.start(bet, None)


def test_collect_pays_the_pot():
    game, r = open_round()
    done = game.act(r.state, 20, {"type": "collect"}, None)
    assert done.finished and done.payout == 300


def test_gamble_win_doubles_and_loss_burns():
    game, r = open_round()
    won = game.act(r.state, 20, {"type": "gamble", "color": "red"}, Picks(0))
    assert not won.finished and won.state["pot"] == 600 and won.state["gambles"] == 1
    assert won.view["crystal"] == "red" and won.view["grid"] == r.view["grid"]

    lost = game.act(won.state, 20, {"type": "gamble", "color": "red"}, Picks(1))
    assert lost.finished and lost.payout == 0
    assert lost.view["crystal"] == "blue" and lost.view["lost"] == 600


def test_gamble_is_refused_when_a_win_would_exceed_the_cap():
    game, r = open_round()  # pot 300, cap 2000
    r = game.act(r.state, 20, {"type": "gamble", "color": "blue"}, Picks(1))  # 600
    assert r.view["can_gamble"] is True
    r = game.act(r.state, 20, {"type": "gamble", "color": "blue"}, Picks(1))  # 1200
    assert r.state["pot"] == 1200 and r.view["can_gamble"] is False
    with pytest.raises(InvalidAction):
        game.act(r.state, 20, {"type": "gamble", "color": "blue"}, Picks(1))


def test_gamble_limited_to_five_doubles():
    state = {"pot": 20, "gambles": 5, "spin": {}}
    with pytest.raises(InvalidAction):
        MinesGame().act(state, 1000, {"type": "gamble", "color": "red"}, Picks(0))


@pytest.mark.parametrize(
    "action", [{"type": "gamble"}, {"type": "gamble", "color": "green"}, {"type": "x"}, {}]
)
def test_bad_actions_are_rejected(action):
    game, r = open_round()
    with pytest.raises(InvalidAction):
        game.act(r.state, 20, action, Picks(0))


def test_abandon_collects_the_pot():
    game, r = open_round()
    out = game.abandon(r.state, 20, None)
    assert out.finished and out.payout == 300 and out.view["auto_collected"] is True


def test_gamble_does_not_change_rtp():
    """Fair 50/50 on exact doubles: expected pot after one gamble equals the pot."""
    game, r = open_round()
    outcomes = [
        game.act(r.state, 20, {"type": "gamble", "color": "red"}, Picks(pick)) for pick in (0, 1)
    ]
    assert sum(o.state["pot"] if not o.finished else 0 for o in outcomes) / 2 == r.state["pot"]


# --- through the API ---------------------------------------------------------------------------


@pytest.fixture
def scripted(app: FastAPI):
    """Registers a Scripted game as 'mines_test' with the grids a test sets on it."""
    holder: dict[str, Scripted] = {}

    def install(*grids):
        game = Scripted(*grids)
        registry.unregister("mines_test")
        registry.register(game)
        holder["game"] = game

    yield install
    registry.unregister("mines_test")


async def test_real_game_is_registered_and_listed(client: AsyncClient, auth: dict[str, str]):
    games = (await client.get("/api/games")).json()
    mines_info = next(g for g in games if g["id"] == "mines")
    assert mines_info == {
        "id": "mines",
        "min_bet": 20,
        "max_bet": 1000,
        "bet_step": 20,
        "max_win_multiplier": 100,
        "rtp": 0.96,
        "modes": MinesGame.modes,
    }


@pytest.mark.parametrize("bet", [10, 25, 30, 1020])
async def test_bet_step_and_range_enforced(client: AsyncClient, auth: dict[str, str], bet: int):
    r = await client.post("/api/games/mines/rounds", json={"bet": bet}, headers=auth)
    assert r.status_code == 422
    assert (await client.get("/api/auth/me", headers=auth)).json()["balance"] == 1000


async def test_real_mines_round_end_to_end(client: AsyncClient, auth: dict[str, str]):
    r = await client.post("/api/games/mines/rounds", json={"bet": 100}, headers=auth)
    assert r.status_code == 201
    body = r.json()
    assert len(body["view"]["grid"]) == 5 and all(len(c) == 3 for c in body["view"]["grid"])
    assert "state" not in body and body["balance"] == 900
    if not body["finished"]:
        assert body["view"]["pending"] > 0 and body["payout"] == 0
        done = await client.post(
            f"/api/rounds/{body['id']}/actions", json={"action": {"type": "collect"}}, headers=auth
        )
        assert done.json()["balance"] == 900 + body["view"]["pending"]


async def test_next_round_collects_pending_win(client: AsyncClient, auth: dict[str, str], scripted):
    scripted(full(COAL), blank())
    first = (
        await client.post("/api/games/mines_test/rounds", json={"bet": 20}, headers=auth)
    ).json()
    assert not first["finished"] and first["balance"] == 980  # win pending, not paid

    second = (
        await client.post("/api/games/mines_test/rounds", json={"bet": 20}, headers=auth)
    ).json()
    assert second["finished"] and second["balance"] == 980 + 300 - 20

    settled = (await client.get(f"/api/rounds/{first['id']}", headers=auth)).json()
    assert settled["finished"] and settled["payout"] == 300
    assert settled["view"]["auto_collected"] is True
    kinds = [t["kind"] for t in (await client.get("/api/wallet/transactions", headers=auth)).json()]
    assert kinds[:3] == ["bet", "win", "bet"]  # second bet, first win, first bet


async def test_win_is_paid_exactly_once(client: AsyncClient, auth: dict[str, str], scripted):
    scripted(full(COAL), blank())
    first = (
        await client.post("/api/games/mines_test/rounds", json={"bet": 20}, headers=auth)
    ).json()
    await client.post(
        f"/api/rounds/{first['id']}/actions", json={"action": {"type": "collect"}}, headers=auth
    )
    await client.post("/api/games/mines_test/rounds", json={"bet": 20}, headers=auth)
    wins = [
        t
        for t in (await client.get("/api/wallet/transactions", headers=auth)).json()
        if t["kind"] == "win"
    ]
    assert len(wins) == 1


# --- play modes ---------------------------------------------------------------------------------


def test_modes_are_priced_in_twentieths_of_the_bet():
    game = MinesGame()
    assert game.cost(100, None) == 100
    assert game.cost(100, "scatter") == 5 * MinesGame.modes["scatter"]
    assert game.cost(100, "buy_bonus") == 5 * MinesGame.modes["buy_bonus"]
    with pytest.raises(InvalidAction):
        game.cost(100, "nope")


def test_buy_bonus_always_starts_free_spins():
    game, rng = MinesGame(), seeded_rng(7)
    for _ in range(20):
        view = game.start(100, rng, "buy_bonus").view
        assert view["free_spins"] is not None and len(view["free_spins"]) == 10
        assert view["mode"] == "buy_bonus" and view["cost"] == game.cost(100, "buy_bonus")


def test_scatter_mode_always_shows_a_dynamite():
    game, rng = MinesGame(), seeded_rng(3)
    for _ in range(200):
        grid = game.start(100, rng, "scatter").view["grid"]
        assert sum(cell == "dynamite" for reel in grid for cell in reel) >= 1


async def test_mode_cost_is_debited_and_cap_stays_on_the_base_bet(client, auth):
    before = (await client.get("/api/auth/me", headers=auth)).json()["balance"]
    r = await client.post(
        "/api/games/mines/rounds", json={"bet": 20, "mode": "scatter"}, headers=auth
    )
    assert r.status_code == 201
    cost = MinesGame().cost(20, "scatter")
    body = r.json()
    assert body["balance"] == before - cost + body["payout"]
    assert body["view"]["cost"] == cost
    assert body["bet"] == 20


async def test_unknown_mode_is_rejected(client, auth):
    r = await client.post("/api/games/mines/rounds", json={"bet": 20, "mode": "nope"}, headers=auth)
    assert r.status_code == 422
    r = await client.post(
        "/api/games/creeper/rounds", json={"bet": 20, "mode": "scatter"}, headers=auth
    )
    assert r.status_code == 422
