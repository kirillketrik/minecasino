import pytest
from httpx import AsyncClient

from app.games import drill as D
from app.games.rng import seeded_rng
from app.games.simulation import simulate


def column(*blocks: str) -> list[str]:
    """A column of 7: the given blocks on top, filled down with obsidian."""
    return [*blocks, *[D.OBSIDIAN] * (D.DEPTH - len(blocks))]


def plain_mine() -> D.Mine:
    return [
        column(D.DIRT, D.STONE, D.COAL, D.IRON, D.GOLD, D.DIAMOND, D.OBSIDIAN)
        for _ in range(D.COLS)
    ]


class Scripted(D.DrillGame):
    """Plays a prepared mine with prepared tools and chests."""

    id = "drill_test"

    def __init__(
        self, mine: D.Mine, tools: list[str], chests: list[int] | None = None, grand: int = 2
    ):
        super().__init__()
        self._mine, self._tool_list = mine, tools
        self._chest_list = chests or [20] * D.COLS
        self._grand_col = grand

    def _draw_mine(self, rng):
        return [list(col) for col in self._mine]

    def _draw_tools(self, rng, kind):
        return list(self._tool_list)

    def _draw_chests(self, rng):
        return list(self._chest_list), self._grand_col


def tools(**by_col: str) -> list[str]:
    out = [D.NONE] * D.COLS
    for key, tool in by_col.items():
        out[int(key[1:])] = tool
    return out


def test_shape_and_tables():
    game = D.DrillGame()
    assert game.id == "drill" and game.min_bet == game.bet_step == 20
    assert set(D.HARDNESS) == set(D.BLOCK_VALUE)
    # Harder blocks are worth more (or the same).
    order = sorted(D.HARDNESS, key=lambda b: (D.HARDNESS[b], D.BLOCK_VALUE[b]))
    values = [D.BLOCK_VALUE[b] for b in order]
    assert values == sorted(values)
    assert all(rows for rows, _ in D.LAYERS) and sum(len(r) for r, _ in D.LAYERS) == D.DEPTH


def test_pickaxe_stops_at_a_block_it_cannot_afford():
    # Stone pick (5): dirt 1 + stone 2 + coal 2 = 5, then iron (3) is out of reach.
    dig = Scripted(plain_mine(), tools(c0=D.STONE_PICK)).dig(seeded_rng(1))
    step = dig.steps[0]
    assert [b for _, _, b in step.broken] == [D.DIRT, D.STONE, D.COAL]
    assert step.units == D.BLOCK_VALUE[D.COAL] and dig.opened == []


def test_wood_pickaxe_cannot_dig_past_hard_top_block():
    mine = plain_mine()
    mine[1][0] = D.OBSIDIAN
    dig = Scripted(mine, tools(c1=D.NETHERITE)).dig(seeded_rng(1))
    assert dig.steps[1].broken[0][2] == D.OBSIDIAN  # netherite (14) breaks it ...
    dig = Scripted(mine, tools(c1=D.WOOD)).dig(seeded_rng(1))
    assert dig.steps[1].broken == [] and dig.units == 0  # ... wood (3) does not


def test_tnt_blasts_three_by_three_ignoring_hardness():
    mine = plain_mine()
    mine[2][0] = D.OBSIDIAN
    dig = Scripted(mine, tools(c2=D.TNT)).dig(seeded_rng(1))
    step = dig.steps[2]
    assert step.impact == 0
    assert {(c, r) for c, r, _ in step.broken} == {(c, r) for c in (1, 2, 3) for r in (0, 1, 2)}


def test_tnt_at_the_edge_hits_two_columns():
    dig = Scripted(plain_mine(), tools(c0=D.TNT)).dig(seeded_rng(1))
    assert {c for c, _, _ in dig.steps[0].broken} == {0, 1}


def test_drill_clears_its_column_and_opens_the_chest():
    chests = [10, 20, 30, 40, 50]
    dig = Scripted(plain_mine(), tools(c3=D.DRILL), chests, grand=0).dig(seeded_rng(1))
    assert len(dig.steps[3].broken) == D.DEPTH
    assert dig.opened == [3] and dig.steps[3].opened == [3]
    assert dig.chest_units == 40
    assert dig.units == dig.block_units + 40


def test_later_tools_use_the_mine_earlier_ones_left():
    # TNT in column 0 breaks the three top layers of columns 0 and 1; a wood pick in column 1
    # then starts at the fourth layer (iron, 3) and pays for it.
    dig = Scripted(plain_mine(), tools(c0=D.TNT, c1=D.WOOD)).dig(seeded_rng(1))
    assert dig.steps[1].impact == 3
    assert [b for _, _, b in dig.steps[1].broken] == [D.IRON]


def test_gaps_left_by_a_blast_cost_the_pickaxe_nothing():
    mine = plain_mine()
    mine[0][3] = D.EMPTY
    broken = Scripted(mine, tools(c0=D.WOOD)).dig(seeded_rng(1)).steps[0].broken
    assert [b for _, _, b in broken] == [
        D.DIRT,
        D.STONE,
    ]  # 1 + 2 = 3, nothing left for the coal at row 2


def test_all_chests_open_doubles_the_spin():
    dig = Scripted(plain_mine(), [D.DRILL] * D.COLS).dig(seeded_rng(1))
    assert dig.cleared and len(dig.opened) == D.COLS
    assert dig.units == (dig.block_units + dig.chest_units) * D.CLEARED_MULTIPLIER


def test_start_pays_immediately_with_unit_scaling():
    game = Scripted(plain_mine(), tools(c3=D.DRILL), [10, 20, 30, 40, 50], grand=0)
    result = game.start(100, seeded_rng(1))  # unit = 5 coins
    dig = game.dig(seeded_rng(1))
    assert result.finished and result.payout == dig.units * 5
    assert result.view["total_win"] == result.payout == result.view["win"]
    assert result.view["steps"][3]["opened"] == [{"col": 3, "prize": 200, "grand": False}]


def test_random_spin_view_is_consistent():
    game = D.DrillGame()
    rng = seeded_rng(9)
    for _ in range(200):
        view = game.start(100, rng).view
        assert len(view["mine"]) == D.COLS and all(len(c) == D.DEPTH for c in view["mine"])
        assert len(view["tools"]) == len(view["steps"]) == len(view["chests"]) == D.COLS
        assert sum(chest["grand"] for chest in view["chests"]) == 1
        assert view["block_win"] + view["chest_win"] in (view["win"], view["win"] // 2)


def test_ante_makes_tools_more_frequent():
    base = D.DrillGame()._tools["base"].probability(D.NONE)
    ante = D.DrillGame()._tools["ante"].probability(D.NONE)
    assert ante < base


def test_simulated_rtp_is_sane():
    game = D.DrillGame()
    report = simulate(game, seeded_rng(21), 60_000, bet=100)
    assert abs(report.z_score(game.target_rtp)) < 4, report
    assert report.max_multiplier <= 100


@pytest.mark.slow
def test_simulated_rtp_matches_target_long_run():
    game = D.DrillGame()
    report = simulate(game, seeded_rng(2025), 2_000_000, bet=100)
    assert abs(report.z_score(game.target_rtp)) < 4, report


async def test_drill_is_listed_and_plays(client: AsyncClient, auth: dict[str, str]):
    games = {g["id"]: g for g in (await client.get("/api/games")).json()}
    assert games["drill"]["min_bet"] == 20 and "ante" in games["drill"]["modes"]
    assert "buy_bonus" not in games["drill"]["modes"]
    r = await client.post("/api/games/drill/rounds", json={"bet": 100}, headers=auth)
    assert r.status_code == 201
    body = r.json()
    assert body["finished"] and body["payout"] == body["view"]["total_win"]
