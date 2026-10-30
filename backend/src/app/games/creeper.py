"""Slot «Крипер»: 6 reels x 5 rows, Pay Anywhere clusters with cascades and free spins.

Rules
- Every cell is drawn independently from the weights below.
- 8 or more of the same block anywhere on the grid win, wherever they sit (no lines, no
  adjacency). Pay depends on the count: 8-9, 10-11 or 12+. Several blocks can win in one wave.
- Winning blocks explode. The remaining cells fall, new ones drop in from the top, and the grid
  is checked again. Each wave is paid with its own multiplier: x1 for the first, then +1 per wave,
  up to x10.
- Creepers never pay or explode. Each carries a value (x2 ... x10). If the spin paid anything,
  the sum of all Creeper values that landed during the spin multiplies the total.
- Portals (scatters) never pay or explode either. Four or more landing in one spin, cascades
  included, award free spins: 10 for four, 12 for five, 15 for six or more.
- In free spins the wave multiplier is off and Creepers become sticky: every Creeper that lands
  adds its value to a multiplier that stays for the rest of the bonus. A spin that wins is paid
  times the multiplier as it stands after that spin. Three or more portals add 5 spins.
- Two extra ways to play (`modes`): an ante bet that makes portals likelier, and buying the bonus
  (the dealt grid gets four portals).
- The round pays at most bet * MAX_WIN_MULTIPLIER and settles immediately, free spins included.

All pays are whole multiples of bet / 20 and the bet must be a multiple of 20, so payouts are exact
integers. RTP has no closed form (cascades depend on the previous grid), so it is calibrated by
simulation with scripts/calibrate_creeper.py; only the first wave is exact (`first_wave_rtp`).
"""

from dataclasses import dataclass
from math import comb
from typing import Any, ClassVar

from app.games.base import MAX_WIN_MULTIPLIER, Tuning
from app.games.rng import Rng, WeightedTable
from app.games.slot import SlotGame, SpinOutcome

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
SCATTER = "scatter"

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
    SCATTER: 22,
}
# The same blocks with more portals (ante bet) and with more Creepers (inside free spins).
ANTE_WEIGHTS: dict[str, int] = {**WEIGHTS, SCATTER: 28}
FREE_WEIGHTS: dict[str, int] = {**WEIGHTS, CREEPER: 24, SCATTER: 14}
TABLE_KINDS = {"base": WEIGHTS, "ante": ANTE_WEIGHTS, "free": FREE_WEIGHTS}

CREEPER_VALUES: dict[int, int] = {2: 70, 3: 20, 5: 8, 10: 2}

# Pay in 1/20 bet for a cluster of 8-9, 10-11, 12+.
PAYTABLE: dict[str, tuple[int, int, int]] = {
    GUNPOWDER: (8, 17, 58),
    REDSTONE: (10, 21, 73),
    LAPIS: (12, 27, 87),
    IRON: (15, 36, 116),
    GOLD: (18, 51, 146),
    EMERALD: (26, 64, 204),
    DIAMOND: (37, 91, 292),
    SKULL: (55, 136, 438),
}

FREE_SPINS_FOR = {4: 10, 5: 12}  # six or more: FREE_SPINS_MAX_AWARD
FREE_SPINS_MAX_AWARD = 15
FREE_SPINS_TRIGGER = 4
RETRIGGER_SCATTERS = 3
RETRIGGER_SPINS = 5
MAX_FREE_SPINS = 60  # safety net on retriggers

ANTE_MODE, BUY_BONUS_MODE = "ante", "buy_bonus"
# Price in 1/20 of the bet. Measured by scripts/calibrate_creeper_modes.py so each mode returns 96%.
MODE_PRICES: dict[str, int] = {ANTE_MODE: 26, BUY_BONUS_MODE: 934}
BOUGHT_SCATTERS = 4

MAX_WAVE_MULTIPLIER = 10
MAX_WAVES = 200  # safety net; a chain this long is astronomically unlikely
DEFAULT_CAP_UNITS = MAX_WIN_MULTIPLIER * UNITS_PER_BET

Grid = list[list[str]]  # grid[col][row], row 0 is the top


def tier(count: int) -> int:
    return 0 if count < 10 else 1 if count < 12 else 2


def is_creeper(cell: str) -> bool:
    return cell.startswith(CREEPER)


def creeper_value(cell: str) -> int:
    return int(cell.split(":")[1])


def free_spins_awarded(scatters: int) -> int:
    if scatters < FREE_SPINS_TRIGGER:
        return 0
    return FREE_SPINS_FOR.get(scatters, FREE_SPINS_MAX_AWARD)


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
    creeper_multiplier: int  # base spin: this spin's Creepers added up; free spin: sticky total
    first_grid: Grid  # as dealt, before any explosion (empty unless recorded)
    final_grid: Grid  # as the spin ended: nothing left to explode, or the cap stopped it
    scatters: int = 0  # portals that landed in the spin, cascades included


@dataclass
class Bonus:
    awarded: int
    spins: list[Resolution]
    retriggers: list[int]  # spins added after each played spin (0 for most)
    units: int  # all spins together, before the cap


class CreeperGame(SlotGame):
    id: ClassVar[str] = "creeper"
    units_per_bet: ClassVar[int] = UNITS_PER_BET
    min_bet: ClassVar[int] = UNITS_PER_BET
    bet_step: ClassVar[int] = UNITS_PER_BET
    modes: ClassVar[dict[str, int]] = MODE_PRICES

    def __init__(self) -> None:
        self._cells = {
            kind: WeightedTable(list(weights), list(weights.values()))
            for kind, weights in TABLE_KINDS.items()
        }
        self._values = WeightedTable(list(CREEPER_VALUES), list(CREEPER_VALUES.values()))

    def _draw_cell(self, rng: Rng, kind: str = "base") -> str:
        block = self._cells[kind].draw(rng)
        if block == CREEPER:
            return f"{CREEPER}:{self._values.draw(rng)}"
        return block

    def _draw_grid(self, rng: Rng, kind: str = "base", force_scatters: int = 0) -> Grid:
        grid = [[self._draw_cell(rng, kind) for _ in range(ROWS)] for _ in range(COLS)]
        placed = 0
        while placed < force_scatters:
            col, row = rng.randbelow(COLS), rng.randbelow(ROWS)
            if grid[col][row] != SCATTER:
                grid[col][row] = SCATTER
                placed += 1
        return grid

    def _fill(self, grid: Grid, rng: Rng, kind: str) -> tuple[list[int], int]:
        """Draw new cells on top of each column's survivors: new Creeper values, new portals."""
        new_creepers: list[int] = []
        new_scatters = 0
        for col in grid:
            fresh = [self._draw_cell(rng, kind) for _ in range(ROWS - len(col))]
            new_creepers.extend(creeper_value(c) for c in fresh if is_creeper(c))
            new_scatters += sum(c == SCATTER for c in fresh)
            col[:0] = fresh
        return new_creepers, new_scatters

    def resolve(
        self,
        rng: Rng,
        *,
        record: bool = True,
        stop_at_cap: bool = True,
        max_waves: int = MAX_WAVES,
        kind: str = "base",
        force_scatters: int = 0,
        sticky: int | None = None,
        cap_units: int = DEFAULT_CAP_UNITS,
    ) -> Resolution:
        """Play one spin through all its cascades. Pays are in 1/20 bet.

        `sticky` is None in the base game. In a free spin it is the multiplier carried in: the
        waves then all pay x1, this spin's Creepers are added to it and the result is returned
        in `creeper_multiplier` (a spin without a win keeps the Creepers but pays nothing).
        """
        if force_scatters:
            grid = self._draw_grid(rng, kind, force_scatters)
        elif kind == "base":
            grid = self._draw_grid(rng)  # the plain call keeps the hook simple to script in tests
        else:
            grid = self._draw_grid(rng, kind)
        first_grid = [list(col) for col in grid] if record else []
        waves: list[Wave] = []
        # Every Creeper and portal is counted once, when it lands; they never leave the grid.
        creepers = [creeper_value(c) for col in grid for c in col if is_creeper(c)]
        scatters = sum(c == SCATTER for col in grid for c in col)
        total = 0
        fill_kind = "free" if sticky is not None else kind

        for number in range(1, max_waves + 1):
            counts: dict[str, int] = {}
            for col in grid:
                for cell in col:
                    if not is_creeper(cell) and cell != SCATTER:
                        counts[cell] = counts.get(cell, 0) + 1
            winners = {s: n for s, n in counts.items() if n >= MIN_CLUSTER}
            if not winners:
                break

            multiplier = 1 if sticky is not None else min(number, MAX_WAVE_MULTIPLIER)
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
            new_creepers, new_scatters = self._fill(grid, rng, fill_kind)
            creepers.extend(new_creepers)
            scatters += new_scatters

        if sticky is None:
            multiplier_total = sum(creepers) if creepers and total > 0 else 1
            units = total * multiplier_total
        else:
            multiplier_total = sticky + sum(creepers)
            units = total * max(1, multiplier_total) if total > 0 else 0
        final_grid = [list(col) for col in grid] if record else []
        return Resolution(
            units, waves, creepers, multiplier_total, first_grid, final_grid, scatters
        )

    def play_bonus(
        self,
        rng: Rng,
        awarded: int,
        *,
        record: bool = True,
        stop_at_cap: bool = True,
        cap_units: int = DEFAULT_CAP_UNITS,
    ) -> Bonus:
        """All free spins of a bonus. Stops early once the pay reaches the win cap."""
        left, sticky, total = awarded, 0, 0
        spins: list[Resolution] = []
        retriggers: list[int] = []
        while left > 0 and len(spins) < MAX_FREE_SPINS:
            res = self.resolve(
                rng,
                record=record,
                stop_at_cap=stop_at_cap,
                kind="free",
                sticky=sticky,
                cap_units=cap_units,
            )
            left -= 1
            sticky = res.creeper_multiplier
            total += res.units
            added = RETRIGGER_SPINS if res.scatters >= RETRIGGER_SCATTERS else 0
            left += added
            spins.append(res)
            retriggers.append(added)
            if stop_at_cap and total >= cap_units:
                break
        return Bonus(awarded, spins, retriggers, total)

    def play(
        self,
        rng: Rng,
        mode: str | None,
        *,
        record: bool = True,
        stop_at_cap: bool = True,
        cap_units: int = DEFAULT_CAP_UNITS,
    ) -> tuple[Resolution, Bonus | None]:
        """The triggering spin and, when it earned them, the free spins."""
        kind = "ante" if mode == ANTE_MODE else "base"
        forced = BOUGHT_SCATTERS if mode == BUY_BONUS_MODE else 0
        base = self.resolve(
            rng,
            record=record,
            stop_at_cap=stop_at_cap,
            kind=kind,
            force_scatters=forced,
            cap_units=cap_units,
        )
        awarded = free_spins_awarded(base.scatters)
        if not awarded:
            return base, None
        if stop_at_cap and base.units >= cap_units:
            return base, None
        return base, self.play_bonus(
            rng, awarded, record=record, stop_at_cap=stop_at_cap, cap_units=cap_units
        )

    @staticmethod
    def _spin_view(res: Resolution, unit: int) -> dict[str, Any]:
        return {
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
            "scatters": res.scatters,
            "win": res.units * unit,
        }

    def spin(self, unit: int, rng: Rng, mode: str | None, tuning: Tuning) -> SpinOutcome:
        base, bonus = self.play(rng, mode, cap_units=tuning.raw_cap_units(UNITS_PER_BET))
        raw = (base.units + (bonus.units if bonus else 0)) * unit
        view: dict[str, Any] = {
            **self._spin_view(base, unit),
            "base_win": base.units * unit,
            "free_spins": None,
        }
        if bonus:
            view["free_spins"] = {
                "awarded": bonus.awarded,
                "spins": [
                    {**self._spin_view(s, unit), "retrigger": added}
                    for s, added in zip(bonus.spins, bonus.retriggers, strict=True)
                ],
                "win": bonus.units * unit,
            }
        return SpinOutcome(raw, view)


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
