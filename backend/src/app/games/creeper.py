"""Slot «Крипер»: 6 reels x 5 rows, Pay Anywhere clusters with cascades.

Rules
- Every cell is drawn independently from the weights below.
- 8 or more of the same block anywhere on the grid win, wherever they sit (no lines, no
  adjacency). Pay depends on the count: 8-9, 10-11 or 12+. Several blocks can win in one wave.
- Winning blocks explode. The remaining cells fall, new ones drop in from the top, and the grid
  is checked again. Each wave is paid with its own multiplier: x1 for the first, then +1 per wave,
  up to x10.
- Creepers never pay or explode. Each carries a value (x2 ... x10). If the round paid anything,
  the sum of all Creeper values that landed during the round multiplies the total.
- The round pays at most bet * MAX_WIN_MULTIPLIER and settles immediately.

All pays are whole multiples of bet / 20 and the bet must be a multiple of 20, so payouts are exact
integers. RTP has no closed form (cascades depend on the previous grid), so it is calibrated by
simulation with scripts/calibrate_creeper.py; only the first wave is exact (`first_wave_rtp`).
"""

from dataclasses import dataclass
from math import comb
from typing import Any, ClassVar

from app.games.base import MAX_WIN_MULTIPLIER, Game, GameResult
from app.games.engine import cap_payout
from app.games.rng import Rng, WeightedTable

COLS, ROWS = 6, 5
CELLS = COLS * ROWS
MIN_CLUSTER = 8
UNITS_PER_BET = 20  # pays are in 1/20 of the bet

GUNPOWDER, REDSTONE, LAPIS, IRON, GOLD, EMERALD, DIAMOND, SKULL = (
    "gunpowder",
    "redstone",
    "lapis",
    "iron",
    "gold",
    "emerald",
    "diamond",
    "skull",
)
PAYING = (GUNPOWDER, REDSTONE, LAPIS, IRON, GOLD, EMERALD, DIAMOND, SKULL)
CREEPER = "creeper"

# Cell weights, rarest block last. Creeper is drawn as a block first, then its value separately.
WEIGHTS: dict[str, int] = {
    GUNPOWDER: 150,
    REDSTONE: 140,
    LAPIS: 130,
    IRON: 120,
    GOLD: 110,
    EMERALD: 100,
    DIAMOND: 90,
    SKULL: 70,
    CREEPER: 6,
}
CREEPER_VALUES: dict[int, int] = {2: 70, 3: 20, 5: 8, 10: 2}

# Pay in 1/20 bet for a cluster of 8-9, 10-11, 12+.
PAYTABLE: dict[str, tuple[int, int, int]] = {
    GUNPOWDER: (8, 19, 62),
    REDSTONE: (10, 23, 78),
    LAPIS: (12, 29, 93),
    IRON: (16, 39, 124),
    GOLD: (19, 54, 155),
    EMERALD: (27, 68, 217),
    DIAMOND: (39, 97, 310),
    SKULL: (58, 145, 466),
}

MAX_WAVE_MULTIPLIER = 10
MAX_WAVES = 200  # safety net; a chain this long is astronomically unlikely

Grid = list[list[str]]  # grid[col][row], row 0 is the top


def tier(count: int) -> int:
    return 0 if count < 10 else 1 if count < 12 else 2


def is_creeper(cell: str) -> bool:
    return cell.startswith(CREEPER)


def creeper_value(cell: str) -> int:
    return int(cell.split(":")[1])


@dataclass
class Wave:
    multiplier: int
    clusters: list[dict[str, Any]]  # symbol, count, units, cells
    units: int  # all clusters of the wave, before the multiplier
    grid: Grid  # as it was when the wave exploded


@dataclass
class Resolution:
    units: int  # total pay in 1/20 bet, before the cap
    waves: list[Wave]
    creepers: list[int]
    creeper_multiplier: int
    first_grid: Grid  # as dealt, before any explosion (empty unless recorded)
    final_grid: Grid  # as the spin ended: nothing left to explode, or the cap stopped it


class CreeperGame(Game):
    id: ClassVar[str] = "creeper"
    min_bet: ClassVar[int] = UNITS_PER_BET
    bet_step: ClassVar[int] = UNITS_PER_BET

    def __init__(self) -> None:
        self._cells = WeightedTable(list(WEIGHTS), list(WEIGHTS.values()))
        self._values = WeightedTable(list(CREEPER_VALUES), list(CREEPER_VALUES.values()))

    def _draw_cell(self, rng: Rng) -> str:
        block = self._cells.draw(rng)
        if block == CREEPER:
            return f"{CREEPER}:{self._values.draw(rng)}"
        return block

    def _draw_grid(self, rng: Rng) -> Grid:
        return [[self._draw_cell(rng) for _ in range(ROWS)] for _ in range(COLS)]

    def _fill(self, grid: Grid, rng: Rng) -> list[int]:
        """Draw new cells on top of each column's survivors; returns the new Creeper values."""
        new_creepers: list[int] = []
        for col in grid:
            fresh = [self._draw_cell(rng) for _ in range(ROWS - len(col))]
            new_creepers.extend(creeper_value(c) for c in fresh if is_creeper(c))
            col[:0] = fresh
        return new_creepers

    def resolve(
        self, rng: Rng, *, record: bool = True, stop_at_cap: bool = True, max_waves: int = MAX_WAVES
    ) -> Resolution:
        """Play one spin through all its cascades. Pays are in 1/20 bet."""
        grid = self._draw_grid(rng)
        first_grid = [list(col) for col in grid] if record else []
        waves: list[Wave] = []
        # Every Creeper is counted once, when it lands; they never leave the grid.
        creepers = [creeper_value(c) for col in grid for c in col if is_creeper(c)]
        total = 0
        cap_units = MAX_WIN_MULTIPLIER * UNITS_PER_BET

        for number in range(1, max_waves + 1):
            counts: dict[str, int] = {}
            for col in grid:
                for cell in col:
                    if not is_creeper(cell):
                        counts[cell] = counts.get(cell, 0) + 1
            winners = {s: n for s, n in counts.items() if n >= MIN_CLUSTER}
            if not winners:
                break

            multiplier = min(number, MAX_WAVE_MULTIPLIER)
            wave_units = sum(PAYTABLE[s][tier(n)] for s, n in winners.items())
            total += wave_units * multiplier
            if record:
                clusters = [
                    {
                        "symbol": s,
                        "count": n,
                        "units": PAYTABLE[s][tier(n)],
                        "cells": [
                            [c, r]
                            for c, col in enumerate(grid)
                            for r, cell in enumerate(col)
                            if cell == s
                        ],
                    }
                    for s, n in winners.items()
                ]
                waves.append(Wave(multiplier, clusters, wave_units, [list(col) for col in grid]))

            if stop_at_cap and total >= cap_units:
                break
            for col_index, col in enumerate(grid):
                grid[col_index] = [cell for cell in col if cell not in winners]
            creepers.extend(self._fill(grid, rng))

        creeper_multiplier = sum(creepers) if creepers and total > 0 else 1
        final_grid = [list(col) for col in grid] if record else []
        return Resolution(
            total * creeper_multiplier, waves, creepers, creeper_multiplier, first_grid, final_grid
        )

    def start(self, bet: int, rng: Rng) -> GameResult:
        unit = bet // UNITS_PER_BET
        res = self.resolve(rng)
        raw = res.units * unit
        payout = cap_payout(bet, raw, MAX_WIN_MULTIPLIER)
        view: dict[str, Any] = {
            "waves": [
                {
                    "multiplier": w.multiplier,
                    "grid": w.grid,
                    "clusters": [
                        {**c, "win": c["units"] * unit * w.multiplier} for c in w.clusters
                    ],
                    "win": w.units * unit * w.multiplier,
                }
                for w in res.waves
            ],
            "grid": res.first_grid,
            "final_grid": res.final_grid,
            "creepers": res.creepers,
            "creeper_multiplier": res.creeper_multiplier,
            "total_win": payout,
        }
        if raw > payout:
            view["capped"] = True
        return GameResult(bet=bet, payout=payout, finished=True, view=view)


# --- exact first wave --------------------------------------------------------------------------


def first_wave_rtp() -> float:
    """Exact expected pay of the first wave alone, as a fraction of the bet (multiplier x1).

    The count of each block in the 30 cells is Binomial(30, p), so this needs no simulation.
    """
    total_weight = sum(WEIGHTS.values())
    expected = 0.0
    for symbol in PAYING:
        p = WEIGHTS[symbol] / total_weight
        for n in range(MIN_CLUSTER, CELLS + 1):
            expected += comb(CELLS, n) * p**n * (1 - p) ** (CELLS - n) * PAYTABLE[symbol][tier(n)]
    return expected / UNITS_PER_BET
