"""Slot «Бурение»: a 5 x 7 mine, tools fall from the top and dig down toward the chests.

Rules
- Each column holds 7 blocks, harder and richer the deeper they lie (dirt and stone on top, ores in
  the middle, gold, diamond and obsidian at the bottom). Below them waits a row of 5 chests.
- On a spin every column draws one tool from the top panel (or nothing):
  * a pickaxe of tier wood ... netherite has durability; it digs down its column, every block it
    breaks costs its hardness, and it stops when the next block is harder than what is left;
  * TNT lands on the top block of its column and blows up a 3 x 3 area (the column and its
    neighbours, three layers deep) whatever the hardness;
  * the Drill bores through its whole column.
  Tools act from left to right, each on the mine as the previous ones left it.
- Every broken block pays its value. A chest opens as soon as nothing is left above it and pays
  its prize; one of the five chests is the main one with a much bigger prize.
- If all five chests are open the whole spin pays x2 (astronomically rare, a pure jackpot).
- One extra way to play (`modes`): an ante bet that makes tools more frequent.

All pays are whole multiples of bet / 20 and the bet must be a multiple of 20. The win is settled
at once and cut by the game's win cap by the base class. RTP is calibrated by simulation with
scripts/measure_rtp.py.
"""

from dataclasses import dataclass
from typing import Any, ClassVar

from app.games.base import Tuning
from app.games.rng import Rng, WeightedTable
from app.games.slot import SlotGame, SpinOutcome

COLS, DEPTH = 5, 7
UNITS_PER_BET = 20

DIRT, STONE, COAL, IRON, REDSTONE, GOLD, DIAMOND, OBSIDIAN = (
    "dirt",
    "stone",
    "coal",
    "iron",
    "redstone",
    "gold",
    "diamond",
    "obsidian",
)
EMPTY = ""

HARDNESS: dict[str, int] = {
    DIRT: 1,
    STONE: 2,
    COAL: 2,
    IRON: 3,
    REDSTONE: 3,
    GOLD: 4,
    DIAMOND: 5,
    OBSIDIAN: 6,
}
# What a broken block pays, in 1/20 of the bet.
BLOCK_VALUE: dict[str, int] = {
    DIRT: 0,
    STONE: 0,
    COAL: 1,
    IRON: 2,
    REDSTONE: 2,
    GOLD: 4,
    DIAMOND: 10,
    OBSIDIAN: 14,
}

# Block weights per layer (row 0 is the top): (rows, weights).
LAYERS: list[tuple[range, dict[str, int]]] = [
    (range(0, 2), {DIRT: 70, STONE: 30}),
    (range(2, 4), {STONE: 55, COAL: 25, IRON: 15, REDSTONE: 5}),
    (range(4, 6), {IRON: 30, REDSTONE: 25, GOLD: 30, COAL: 15}),
    (range(6, 7), {GOLD: 40, DIAMOND: 35, OBSIDIAN: 25}),
]

NONE, WOOD, STONE_PICK, IRON_PICK, DIAMOND_PICK, NETHERITE, TNT, DRILL = (
    "none",
    "wood",
    "stone_pick",
    "iron_pick",
    "diamond_pick",
    "netherite",
    "tnt",
    "drill",
)
DURABILITY: dict[str, int] = {WOOD: 3, STONE_PICK: 5, IRON_PICK: 7, DIAMOND_PICK: 10, NETHERITE: 14}
TNT_WIDTH, TNT_DEPTH = 1, 3  # blast: 1 column each side, 3 layers down from the top block

TOOL_WEIGHTS: dict[str, int] = {
    NONE: 36,
    WOOD: 20,
    STONE_PICK: 15,
    IRON_PICK: 10,
    DIAMOND_PICK: 6,
    NETHERITE: 3,
    TNT: 8,
    DRILL: 2,
}
ANTE_TOOL_WEIGHTS: dict[str, int] = {**TOOL_WEIGHTS, NONE: 18}

# Chest prizes in 1/20 of the bet: ordinary chests and the main one.
CHEST_PRIZES: dict[int, int] = {20: 48, 40: 32, 100: 14, 200: 5, 400: 1}
GRAND_PRIZES: dict[int, int] = {200: 50, 400: 32, 1000: 14, 2000: 4}
CLEARED_MULTIPLIER = 2

ANTE_MODE = "ante"
# Price in 1/20 of the bet, measured with scripts/measure_rtp.py so the mode also returns 96%.
MODE_PRICES: dict[str, int] = {ANTE_MODE: 25}

Mine = list[list[str]]  # mine[col][row], row 0 is the top; EMPTY once broken


@dataclass
class Step:
    col: int
    tool: str
    impact: int  # row where the tool starts working (TNT: the top block it landed on)
    broken: list[tuple[int, int, str]]  # col, row, block
    units: int  # blocks broken by this tool
    opened: list[int]  # columns whose chest this tool opened


@dataclass
class Dig:
    mine: Mine  # as dealt
    tools: list[str]
    steps: list[Step]
    chests: list[int]  # prize of each chest, in 1/20 bet
    grand: int  # column of the main chest
    opened: list[int]  # columns whose chest opened, in order
    block_units: int
    chest_units: int
    cleared: bool
    units: int  # whole spin in 1/20 bet, before the cap


def top_of(column: list[str]) -> int:
    """Row of the highest block left in a column, DEPTH when none is left."""
    for row, block in enumerate(column):
        if block != EMPTY:
            return row
    return DEPTH


class DrillGame(SlotGame):
    id: ClassVar[str] = "drill"
    units_per_bet: ClassVar[int] = UNITS_PER_BET
    min_bet: ClassVar[int] = UNITS_PER_BET
    bet_step: ClassVar[int] = UNITS_PER_BET
    modes: ClassVar[dict[str, int]] = MODE_PRICES

    def __init__(self) -> None:
        self._layers = [(rows, WeightedTable(list(w), list(w.values()))) for rows, w in LAYERS]
        self._tools = {
            "base": WeightedTable(list(TOOL_WEIGHTS), list(TOOL_WEIGHTS.values())),
            "ante": WeightedTable(list(ANTE_TOOL_WEIGHTS), list(ANTE_TOOL_WEIGHTS.values())),
        }
        self._chests = WeightedTable(list(CHEST_PRIZES), list(CHEST_PRIZES.values()))
        self._grand = WeightedTable(list(GRAND_PRIZES), list(GRAND_PRIZES.values()))

    def _draw_mine(self, rng: Rng) -> Mine:
        mine: Mine = []
        for _ in range(COLS):
            column = [EMPTY] * DEPTH
            for rows, table in self._layers:
                for row in rows:
                    column[row] = table.draw(rng)
            mine.append(column)
        return mine

    def _draw_tools(self, rng: Rng, kind: str) -> list[str]:
        return [self._tools[kind].draw(rng) for _ in range(COLS)]

    def _draw_chests(self, rng: Rng) -> tuple[list[int], int]:
        grand = rng.randbelow(COLS)
        chests = [self._chests.draw(rng) for _ in range(COLS)]
        chests[grand] = self._grand.draw(rng)
        return chests, grand

    @staticmethod
    def _use(mine: Mine, col: int, tool: str) -> tuple[int, list[tuple[int, int, str]]]:
        """Apply one tool to the mine. Returns the row it started at and the blocks it broke."""
        broken: list[tuple[int, int, str]] = []
        start = top_of(mine[col])
        if start >= DEPTH or tool == NONE:
            return start, broken
        if tool == DRILL:
            rows = range(start, DEPTH)
            cells = [(col, r) for r in rows]
        elif tool == TNT:
            cells = [
                (c, r)
                for c in range(max(0, col - TNT_WIDTH), min(COLS, col + TNT_WIDTH + 1))
                for r in range(start, min(DEPTH, start + TNT_DEPTH))
            ]
        else:
            left = DURABILITY[tool]
            cells = []
            for r in range(start, DEPTH):
                if mine[col][r] == EMPTY:  # a gap left by a blast costs nothing
                    continue
                cost = HARDNESS[mine[col][r]]
                if cost > left:
                    break
                left -= cost
                cells.append((col, r))
        for c, r in cells:
            if mine[c][r] != EMPTY:
                broken.append((c, r, mine[c][r]))
                mine[c][r] = EMPTY
        return start, broken

    def dig(self, rng: Rng, kind: str = "base") -> Dig:
        mine = self._draw_mine(rng)
        dealt = [list(col) for col in mine]
        tools = self._draw_tools(rng, kind)
        chests, grand = self._draw_chests(rng)
        steps: list[Step] = []
        opened: list[int] = []
        block_units = chest_units = 0
        for col, tool in enumerate(tools):
            impact, broken = self._use(mine, col, tool)
            units = sum(BLOCK_VALUE[b] for _, _, b in broken)
            fresh = [c for c in range(COLS) if c not in opened and top_of(mine[c]) >= DEPTH]
            opened.extend(fresh)
            block_units += units
            chest_units += sum(chests[c] for c in fresh)
            steps.append(Step(col, tool, impact, broken, units, fresh))
        cleared = len(opened) == COLS
        total = block_units + chest_units
        if cleared:
            total *= CLEARED_MULTIPLIER
        return Dig(
            dealt, tools, steps, chests, grand, opened, block_units, chest_units, cleared, total
        )

    def spin(self, unit: int, rng: Rng, mode: str | None, tuning: Tuning) -> SpinOutcome:
        dig = self.dig(rng, "ante" if mode == ANTE_MODE else "base")
        view: dict[str, Any] = {
            "mine": dig.mine,
            "tools": dig.tools,
            "steps": [
                {
                    "col": s.col,
                    "tool": s.tool,
                    "impact": s.impact,
                    "broken": [[c, r, b] for c, r, b in s.broken],
                    "win": s.units * unit,
                    "opened": [
                        {"col": c, "prize": dig.chests[c] * unit, "grand": c == dig.grand}
                        for c in s.opened
                    ],
                }
                for s in dig.steps
            ],
            "chests": [
                {"prize": p * unit, "grand": c == dig.grand} for c, p in enumerate(dig.chests)
            ],
            "block_win": dig.block_units * unit,
            "chest_win": dig.chest_units * unit,
            "cleared": dig.cleared,
            "multiplier": CLEARED_MULTIPLIER if dig.cleared else 1,
            "win": dig.units * unit,
        }
        return SpinOutcome(dig.units * unit, view)
