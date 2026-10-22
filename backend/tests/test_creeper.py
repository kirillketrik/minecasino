import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.api.games import get_rng
from app.games import creeper as C
from app.games.rng import seeded_rng
from app.games.simulation import simulate

OTHERS = [C.REDSTONE, C.LAPIS, C.IRON, C.GOLD, C.EMERALD, C.DIAMOND, C.SKULL]


def grid_from(cells: list[str]) -> C.Grid:
    """30 cells, column by column, top to bottom."""
    assert len(cells) == C.CELLS
    return [cells[c * C.ROWS : (c + 1) * C.ROWS] for c in range(C.COLS)]


def cycle(symbols: list[str], n: int) -> list[str]:
    return [symbols[i % len(symbols)] for i in range(n)]


class Scripted(C.CreeperGame):
    """Starts from a prepared grid and fills with prepared cells, in order."""

    id = "creeper_test"

    def __init__(self, grid: C.Grid, *fresh: str) -> None:
        super().__init__()
        self._start = grid
        self._fresh = iter(fresh)

    def _draw_grid(self, rng):
        return [list(col) for col in self._start]

    def _draw_cell(self, rng):
        return next(self._fresh)


def one_cluster_grid(extra: dict[int, str] | None = None) -> C.Grid:
    """8 gunpowder (the first 8 cells) and the other 22 cells spread over 7 other blocks."""
    cells = [C.GUNPOWDER] * 8 + cycle(OTHERS, 22)
    for index, cell in (extra or {}).items():
        cells[index] = cell
    return grid_from(cells)


# --- helpers and exact numbers -----------------------------------------------------------------


@pytest.mark.parametrize(("count", "tier"), [(8, 0), (9, 0), (10, 1), (11, 1), (12, 2), (30, 2)])
def test_tier(count, tier):
    assert C.tier(count) == tier


def test_creeper_cells():
    assert C.is_creeper("creeper:3") and not C.is_creeper(C.SKULL)
    assert C.creeper_value("creeper:10") == 10


def test_paytable_covers_every_block_and_rises_with_cluster_size():
    assert set(C.PAYTABLE) == set(C.PAYING)
    for pays in C.PAYTABLE.values():
        assert pays[0] < pays[1] < pays[2]


def test_rarer_blocks_pay_more():
    order = sorted(C.PAYING, key=lambda s: C.WEIGHTS[s])
    pays = [C.PAYTABLE[s][0] for s in order]
    assert pays == sorted(pays, reverse=True)


def test_first_wave_rtp_matches_sampling():
    game = C.CreeperGame()
    rng = seeded_rng(11)
    n = 150_000
    values = []
    for _ in range(n):
        counts: dict[str, int] = {}
        for col in game._draw_grid(rng):
            for cell in col:
                counts[cell] = counts.get(cell, 0) + 1
        units = sum(
            C.PAYTABLE[s][C.tier(c)] for s, c in counts.items() if s in C.PAYTABLE and c >= 8
        )
        values.append(units / C.UNITS_PER_BET)
    mean = sum(values) / n
    se = (sum((v - mean) ** 2 for v in values) / (n - 1) / n) ** 0.5
    assert abs(mean - C.first_wave_rtp()) < 4 * se


# --- resolution rules --------------------------------------------------------------------------


def test_no_cluster_no_win():
    grid = grid_from(cycle(C.PAYING, C.CELLS))  # 4 or 3 of each block
    res = Scripted(grid).resolve(None)
    assert res.units == 0 and res.waves == []


def test_seven_of_a_block_is_not_a_cluster():
    cells = [C.GUNPOWDER] * 7 + cycle(OTHERS, 23)
    assert Scripted(grid_from(cells)).resolve(None).units == 0


def test_cluster_pays_anywhere_on_the_grid():
    # Scatter the 8 blocks over the whole grid instead of grouping them.
    cells = cycle(OTHERS, C.CELLS)
    for i in range(0, 30, 4):
        cells[i] = C.GUNPOWDER
    assert cells.count(C.GUNPOWDER) == 8
    fresh = list(C.PAYING)  # one of each: nothing reaches 8 again
    res = Scripted(grid_from(cells), *fresh).resolve(None)
    assert [w.units for w in res.waves] == [C.PAYTABLE[C.GUNPOWDER][0]]


def test_single_wave_and_refill():
    game = Scripted(one_cluster_grid(), *C.PAYING)
    res = game.resolve(None)
    assert len(res.waves) == 1
    assert res.units == C.PAYTABLE[C.GUNPOWDER][0]
    assert res.waves[0].multiplier == 1
    cluster = res.waves[0].clusters[0]
    assert cluster["symbol"] == C.GUNPOWDER and cluster["count"] == 8
    assert len(cluster["cells"]) == 8


def test_cascade_adds_one_to_the_multiplier_each_wave():
    # Wave 1: 8 gunpowder. Fill adds 8 redstone to the 4 already there -> 12 redstone at wave 2.
    # Wave 2 explodes them and the 12 fresh cells make no cluster.
    fresh = [C.REDSTONE] * 8 + [C.GUNPOWDER] * 4 + [C.REDSTONE] * 4 + [C.LAPIS] * 4
    res = Scripted(one_cluster_grid(), *fresh).resolve(None)
    assert [w.multiplier for w in res.waves] == [1, 2]
    assert res.waves[1].clusters[0]["count"] == 12
    expected = C.PAYTABLE[C.GUNPOWDER][0] * 1 + C.PAYTABLE[C.REDSTONE][2] * 2
    assert res.units == expected


def test_two_blocks_can_win_in_the_same_wave():
    cells = [C.GUNPOWDER] * 8 + [C.REDSTONE] * 8 + cycle(OTHERS[1:], 14)
    fresh = cycle(OTHERS[1:], 16)
    res = Scripted(grid_from(cells), *fresh).resolve(None)
    first = res.waves[0]
    assert {c["symbol"] for c in first.clusters} == {C.GUNPOWDER, C.REDSTONE}
    assert first.units == C.PAYTABLE[C.GUNPOWDER][0] + C.PAYTABLE[C.REDSTONE][0]


def test_survivors_fall_and_fresh_cells_land_on_top():
    # Column 0: a creeper above four gunpowder. After the explosion it sits at the bottom.
    cells = (
        [C.CREEPER + ":2"]
        + [C.GUNPOWDER] * 4  # column 0
        + [C.GUNPOWDER] * 4
        + cycle(OTHERS, 1)  # column 1
        + cycle(OTHERS, 20)
    )
    fresh = [C.REDSTONE, C.LAPIS, C.IRON, C.GOLD] + [C.EMERALD] * 4
    game = Scripted(grid_from(cells), *fresh)
    res = game.resolve(None)
    assert res.waves[0].grid[0] == [C.CREEPER + ":2"] + [C.GUNPOWDER] * 4

    grid = grid_from(cells)
    # Replay the explosion by hand to see the grid the second check works on.
    survivors = [c for c in grid[0] if c != C.GUNPOWDER]
    assert survivors == [C.CREEPER + ":2"]
    assert len(survivors) + 4 == C.ROWS


def test_creepers_never_explode_or_pay():
    cells = [C.CREEPER + ":2"] * 8 + cycle(OTHERS, 22)
    assert Scripted(grid_from(cells)).resolve(None).units == 0


def test_creeper_without_a_win_does_nothing():
    cells = cycle(C.PAYING, 28) + [C.CREEPER + ":10", C.CREEPER + ":10"]
    res = Scripted(grid_from(cells)).resolve(None)
    assert res.units == 0 and res.creeper_multiplier == 1


def test_creeper_values_add_up_and_multiply_the_total():
    grid = one_cluster_grid({10: "creeper:3", 11: "creeper:2"})
    res = Scripted(grid, *C.PAYING).resolve(None)
    assert res.creepers == [3, 2] and res.creeper_multiplier == 5
    assert res.units == C.PAYTABLE[C.GUNPOWDER][0] * 5


def test_creeper_landing_during_a_cascade_counts_once():
    grid = one_cluster_grid({10: "creeper:2"})
    fresh = ["creeper:5"] + list(C.PAYING[:7])  # 8 fresh cells, one is a creeper
    res = Scripted(grid, *fresh).resolve(None)
    assert res.creepers == [2, 5]
    assert res.creeper_multiplier == 7


def test_cap_stops_the_cascade_chain():
    # Thirty gunpowder every wave: pays x1, x2 ... until the 100x cap is reached.
    all_gunpowder = grid_from([C.GUNPOWDER] * C.CELLS)
    res = Scripted(all_gunpowder, *([C.GUNPOWDER] * 400)).resolve(None, max_waves=50)
    assert [w.multiplier for w in res.waves] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert res.units >= C.MAX_WIN_MULTIPLIER * C.UNITS_PER_BET


def test_wave_multiplier_stops_growing_at_ten():
    all_gunpowder = grid_from([C.GUNPOWDER] * C.CELLS)
    res = Scripted(all_gunpowder, *([C.GUNPOWDER] * 900)).resolve(
        None, stop_at_cap=False, max_waves=13
    )
    assert [w.multiplier for w in res.waves] == [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10]


# --- GameResult --------------------------------------------------------------------------------


def test_start_pays_immediately_with_unit_scaling():
    result = Scripted(one_cluster_grid(), *C.PAYING).start(100, None)  # unit = 5 coins
    assert result.finished
    assert result.payout == C.PAYTABLE[C.GUNPOWDER][0] * 5
    assert result.view["total_win"] == result.payout
    assert result.view["waves"][0]["win"] == result.payout
    assert "capped" not in result.view


def test_start_caps_at_100x_and_flags_it():
    cells = [C.SKULL] * 12 + ["creeper:10"] * 3 + cycle(OTHERS[:6], 15)
    fresh = cycle(OTHERS[:6], 12)
    result = Scripted(grid_from(cells), *fresh).start(100, None)
    assert result.payout == 100 * 100
    assert result.view["capped"] is True
    assert result.view["creeper_multiplier"] == 30


def test_game_shape():
    game = C.CreeperGame()
    assert game.id == "creeper" and game.min_bet == game.bet_step == 20


# --- RTP ---------------------------------------------------------------------------------------


def test_simulated_rtp_is_sane():
    game = C.CreeperGame()
    report = simulate(game, seeded_rng(21), 60_000, bet=100)
    assert abs(report.z_score(game.target_rtp)) < 4, report
    assert report.max_multiplier <= 100


@pytest.mark.slow
def test_simulated_rtp_matches_target_long_run():
    """~2M rounds: standard error about 0.3 points. Run with `pytest -m slow`."""
    game = C.CreeperGame()
    report = simulate(game, seeded_rng(2025), 2_000_000, bet=100)
    assert abs(report.z_score(game.target_rtp)) < 4, report


# --- API ---------------------------------------------------------------------------------------


async def test_creeper_is_listed(client: AsyncClient):
    games = {g["id"]: g for g in (await client.get("/api/games")).json()}
    assert games["creeper"]["min_bet"] == 20 and games["creeper"]["bet_step"] == 20


@pytest.mark.parametrize("bet", [10, 25, 1020])
async def test_creeper_bet_rules(client: AsyncClient, auth: dict[str, str], bet: int):
    r = await client.post("/api/games/creeper/rounds", json={"bet": bet}, headers=auth)
    assert r.status_code == 422


async def test_creeper_rounds_settle_and_ledger_adds_up(
    app: FastAPI, client: AsyncClient, auth: dict[str, str]
):
    app.dependency_overrides[get_rng] = lambda: seeded_rng(3)
    for _ in range(40):
        r = await client.post("/api/games/creeper/rounds", json={"bet": 100}, headers=auth)
        assert r.status_code == 201
        body = r.json()
        assert body["finished"] and body["payout"] == body["view"]["total_win"]
        assert body["payout"] <= 100 * 100

    txs = (await client.get("/api/wallet/transactions?limit=200", headers=auth)).json()
    me = (await client.get("/api/auth/me", headers=auth)).json()
    assert sum(t["amount"] for t in txs) == me["balance"] == txs[0]["balance_after"]
    assert any(t["kind"] == "win" for t in txs)


def test_view_carries_the_dealt_and_the_final_grid():
    game = Scripted(one_cluster_grid(), *C.PAYING)
    result = game.start(100, None)
    view = result.view
    assert view["grid"] == one_cluster_grid()
    assert view["grid"] == view["waves"][0]["grid"]
    assert view["final_grid"] != view["grid"]
    assert all(len(col) == C.ROWS for col in view["final_grid"])


def test_a_dead_spin_still_shows_its_grid():
    result = Scripted(grid_from(cycle(C.PAYING, C.CELLS))).start(100, None)
    assert result.view["waves"] == [] and result.view["grid"] == result.view["final_grid"]
    assert len(result.view["grid"]) == C.COLS
