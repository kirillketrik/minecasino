import pytest
from httpx import AsyncClient

from app.games import ender as E
from app.games.rng import seeded_rng
from app.games.simulation import simulate

OTHERS = [E.ENDSTONE, E.OBSIDIAN, E.PEARL, E.EYE, E.SHULKER, E.WINGS, E.HEAD]


def grid_from(cells: list[str]) -> E.Grid:
    assert len(cells) == E.CELLS
    return [cells[c * E.ROWS : (c + 1) * E.ROWS] for c in range(E.COLS)]


def cycle(symbols: list[str], n: int) -> list[str]:
    return [symbols[i % len(symbols)] for i in range(n)]


class Scripted(E.EnderGame):
    """Starts from a prepared grid and fills with prepared cells, in order."""

    id = "ender_test"

    def __init__(self, grid: E.Grid, *fresh: str) -> None:
        super().__init__()
        self._start = grid
        self._fresh = iter(fresh)

    def _draw_grid(self, rng, kind="base", force_scatters=0):
        return [list(col) for col in self._start]

    def _draw_cell(self, rng, kind="base"):
        return next(self._fresh)


def one_cluster_grid(extra: dict[int, str] | None = None) -> E.Grid:
    """8 chorus (the first 8 cells) and the other 22 cells spread over 7 other blocks."""
    cells = [E.CHORUS] * 8 + cycle(OTHERS, 22)
    for index, cell in (extra or {}).items():
        cells[index] = cell
    return grid_from(cells)


def test_shape_and_paytable():
    game = E.EnderGame()
    assert game.id == "ender" and game.min_bet == game.bet_step == 20
    assert set(E.PAYTABLE) == set(E.PAYING)
    for pays in E.PAYTABLE.values():
        assert pays[0] < pays[1] < pays[2]
    order = sorted(E.PAYING, key=lambda s: E.WEIGHTS[s])
    pays = [E.PAYTABLE[s][0] for s in order]
    assert pays == sorted(pays, reverse=True)


@pytest.mark.parametrize(
    ("scatters", "pay"), [(0, 0), (3, 0), (4, 60), (5, 100), (6, 2000), (11, 2000)]
)
def test_scatter_pay(scatters, pay):
    assert E.scatter_pay(scatters) == pay


def test_tumbles_pay_at_face_value_without_a_ramp():
    # Wave 1: 8 chorus. The refill makes 12 endstone in wave 2; no multiplier grows between them.
    fresh = [E.ENDSTONE] * 8 + [E.HEAD] * 4 + [E.ENDSTONE] * 4 + [E.PEARL] * 4
    res = Scripted(one_cluster_grid(), *fresh).resolve(None)
    assert len(res.waves) == 2
    assert res.units == E.PAYTABLE[E.CHORUS][0] + E.PAYTABLE[E.ENDSTONE][2]
    assert res.multiplier == 1


def test_eggs_never_pay_and_multiply_only_a_win():
    dead = grid_from(cycle(E.PAYING, 28) + ["egg:10", "egg:10"])
    res = Scripted(dead).resolve(None)
    assert res.units == 0 and res.multiplier == 1

    res = Scripted(one_cluster_grid({10: "egg:3", 11: "egg:2"}), *E.PAYING).resolve(None)
    assert res.eggs == [3, 2] and res.multiplier == 5
    assert res.units == E.PAYTABLE[E.CHORUS][0] * 5


def test_an_egg_landing_in_a_tumble_counts_once():
    fresh = ["egg:5"] + list(E.PAYING[:7])
    res = Scripted(one_cluster_grid({10: "egg:2"}), *fresh).resolve(None)
    assert res.eggs == [2, 5] and res.multiplier == 7


def test_crystals_pay_on_their_own_and_are_counted_when_they_land():
    # Three crystals dealt, one more drops in with the refill: four pay x3 the bet.
    grid = one_cluster_grid({8: E.SCATTER, 9: E.SCATTER, 10: E.SCATTER})
    res = Scripted(grid, E.SCATTER, *E.PAYING).resolve(None)
    assert res.scatters == 4 and res.scatter_units == 60
    assert res.units == E.PAYTABLE[E.CHORUS][0] + 60


def test_free_spin_keeps_the_eggs_and_pays_no_crystal_win():
    grid = one_cluster_grid({10: "egg:3", 20: E.SCATTER, 21: E.SCATTER, 22: E.SCATTER})
    res = Scripted(grid, *E.PAYING).resolve(None, kind="free", kept=4)
    assert res.multiplier == 7 and res.scatters == 3
    assert res.units == E.PAYTABLE[E.CHORUS][0] * 7 and res.scatter_units == 0


def test_cap_stops_the_tumble_chain():
    res = Scripted(grid_from([E.HEAD] * E.CELLS), *([E.HEAD] * 400)).resolve(None, max_waves=50)
    assert len(res.waves) == 3  # 690 + 690 + 690 reaches the 2000 cap
    assert res.units >= E.MAX_WIN_MULTIPLIER * E.UNITS_PER_BET


def test_start_pays_immediately_with_unit_scaling():
    result = Scripted(one_cluster_grid(), *E.PAYING).start(100, None)  # unit = 5 coins
    assert result.finished and result.payout == E.PAYTABLE[E.CHORUS][0] * 5
    assert result.view["total_win"] == result.payout == result.view["waves"][0]["win"]


def test_bought_bonus_starts_free_spins():
    base, bonus = E.EnderGame().play(seeded_rng(5), E.BUY_BONUS_MODE, stop_at_cap=False)
    assert base.scatters >= E.FREE_SPINS_TRIGGER
    assert bonus is not None and bonus.awarded == E.FREE_SPINS_AWARD
    assert len(bonus.spins) >= E.FREE_SPINS_AWARD


def test_simulated_rtp_is_sane():
    game = E.EnderGame()
    report = simulate(game, seeded_rng(21), 60_000, bet=100)
    assert abs(report.z_score(game.target_rtp)) < 4, report
    assert report.max_multiplier <= 100


@pytest.mark.slow
def test_simulated_rtp_matches_target_long_run():
    game = E.EnderGame()
    report = simulate(game, seeded_rng(2025), 2_000_000, bet=100)
    assert abs(report.z_score(game.target_rtp)) < 4, report


async def test_ender_is_listed_and_plays(client: AsyncClient, auth: dict[str, str]):
    games = {g["id"]: g for g in (await client.get("/api/games")).json()}
    assert games["ender"]["min_bet"] == 20 and "buy_bonus" in games["ender"]["modes"]
    r = await client.post("/api/games/ender/rounds", json={"bet": 100}, headers=auth)
    assert r.status_code == 201
    body = r.json()
    assert body["finished"] and body["payout"] == body["view"]["total_win"]
