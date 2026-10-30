"""Slot «Врата Края»: 6 reels x 5 rows, Pay Anywhere clusters, tumbles, Dragon Egg multipliers.

The mechanics follow the "scatter pays + tumble + multiplier orbs" family (Gates of Olympus) in
Minecraft clothes: the End, its island and the dragon.

Rules
- Every cell is drawn independently from the weights below.
- 8 or more of the same block anywhere on the grid win (no lines, no adjacency). Pay depends on the
  count: 8-9, 10-11 or 12+. Several blocks can win in one tumble.
- Winning blocks vanish, the rest fall, new ones drop in from the top and the grid is checked
  again. Tumbles pay at face value: there is no ramp of multipliers.
- Dragon Eggs never pay or vanish. Each carries a value (x2 ... x500). When the tumbling stops,
  the sum of all Eggs that landed during the spin multiplies the spin's win (if it won anything).
- End Crystals (scatters) never pay a cluster or vanish. Four, five or six and more of them in a
  spin pay x3, x5 or x100 the bet on their own, wherever they landed, and four or more start 15
  free spins.
- In free spins every Egg that lands adds its value to a multiplier that is kept for the rest of
  the bonus; a spin that wins is paid times the multiplier as it stands after that spin. Three or
  more crystals add 5 spins.
- Two extra ways to play (`modes`): an ante bet that makes crystals likelier, and buying the
  bonus (the dealt grid gets four crystals).
- The round pays at most bet * the game's win cap and settles immediately, free spins included.

All pays are whole multiples of bet / 20 and the bet must be a multiple of 20, so payouts are exact
integers. RTP has no closed form (tumbles depend on the previous grid), so it is calibrated by
simulation with scripts/calibrate_ender.py; only the first tumble is exact (`first_wave_rtp`).
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

CHORUS, ENDSTONE, OBSIDIAN, PEARL, EYE, SHULKER, WINGS, HEAD = (
    "chorus",
    "endstone",
    "obsidian",
    "pearl",
    "eye",
    "shulker",
    "wings",
    "head",
)
PAYING = (CHORUS, ENDSTONE, OBSIDIAN, PEARL, EYE, SHULKER, WINGS, HEAD)
EGG = "egg"
SCATTER = "scatter"

# Cell weights, rarest block last. An Egg is drawn as a block first, then its value separately.
WEIGHTS: dict[str, int] = {
    CHORUS: 160,
    ENDSTONE: 150,
    OBSIDIAN: 130,
    PEARL: 120,
    EYE: 100,
    SHULKER: 80,
    WINGS: 60,
    HEAD: 40,
    EGG: 9,
    SCATTER: 12,
}
# The same blocks with more crystals (ante bet) and with more Eggs (inside free spins).
ANTE_WEIGHTS: dict[str, int] = {**WEIGHTS, SCATTER: 16}
FREE_WEIGHTS: dict[str, int] = {**WEIGHTS, EGG: 22, SCATTER: 14}
TABLE_KINDS = {"base": WEIGHTS, "ante": ANTE_WEIGHTS, "free": FREE_WEIGHTS}

EGG_VALUES: dict[int, int] = {
    2: 487,
    3: 200,
    4: 120,
    5: 80,
    6: 60,
    8: 40,
    10: 32,
    12: 20,
    15: 15,
    20: 10,
    25: 8,
    50: 4,
    100: 2,
    250: 1,
    500: 1,
}

# Pay in 1/20 bet for a cluster of 8-9, 10-11, 12+.
PAYTABLE: dict[str, tuple[int, int, int]] = {
    CHORUS: (3, 7, 21),
    ENDSTONE: (3, 10, 29),
    OBSIDIAN: (6, 13, 55),
    PEARL: (7, 15, 72),
    EYE: (14, 22, 138),
    SHULKER: (28, 69, 207),
    WINGS: (35, 138, 345),
    HEAD: (138, 345, 690),
}
# What 4, 5 and 6+ crystals pay by themselves, in 1/20 bet.
SCATTER_PAY: dict[int, int] = {4: 60, 5: 100, 6: 2000}

FREE_SPINS_AWARD = 15
FREE_SPINS_TRIGGER = 4
RETRIGGER_SCATTERS = 3
RETRIGGER_SPINS = 5
MAX_FREE_SPINS = 60  # safety net on retriggers

ANTE_MODE, BUY_BONUS_MODE = "ante", "buy_bonus"
# Price in 1/20 of the bet. Measured by scripts/calibrate_ender.py so each mode returns 96%.
MODE_PRICES: dict[str, int] = {ANTE_MODE: 24, BUY_BONUS_MODE: 1736}
BOUGHT_SCATTERS = 4

MAX_WAVES = 200  # safety net; a chain this long is astronomically unlikely
DEFAULT_CAP_UNITS = MAX_WIN_MULTIPLIER * UNITS_PER_BET

Grid = list[list[str]]  # grid[col][row], row 0 is the top


def tier(count: int) -> int:
    return 0 if count < 10 else 1 if count < 12 else 2


def is_egg(cell: str) -> bool:
    return cell.startswith(EGG)


def egg_value(cell: str) -> int:
    return int(cell.split(":")[1])


def scatter_pay(scatters: int) -> int:
    """What the crystals of one spin pay on their own, in 1/20 bet."""
    if scatters < FREE_SPINS_TRIGGER:
        return 0
    return SCATTER_PAY[min(scatters, max(SCATTER_PAY))]


@dataclass
class Wave:
    clusters: list[dict[str, Any]]  # symbol, count, units, cells
    units: int  # all clusters of the wave
    grid: Grid  # as it was when the wave vanished


@dataclass
class Resolution:
    units: int  # total pay in 1/20 bet, before the cap (crystal pay included)
    waves: list[Wave]
    eggs: list[int]
    multiplier: int  # base spin: this spin's Eggs added up; free spin: the multiplier kept so far
    first_grid: Grid  # as dealt, before any tumble (empty unless recorded)
    final_grid: Grid  # as the spin ended: nothing left to tumble, or the cap stopped it
    scatters: int = 0  # crystals that landed in the spin, tumbles included
    scatter_units: int = 0  # what they paid on their own


@dataclass
class Bonus:
    awarded: int
    spins: list[Resolution]
    retriggers: list[int]  # spins added after each played spin (0 for most)
    units: int  # all spins together, before the cap


class EnderGame(SlotGame):
    id: ClassVar[str] = "ender"
    units_per_bet: ClassVar[int] = UNITS_PER_BET
    min_bet: ClassVar[int] = UNITS_PER_BET
    bet_step: ClassVar[int] = UNITS_PER_BET
    modes: ClassVar[dict[str, int]] = MODE_PRICES

    def __init__(self) -> None:
        self._cells = {
            kind: WeightedTable(list(weights), list(weights.values()))
            for kind, weights in TABLE_KINDS.items()
        }
        self._values = WeightedTable(list(EGG_VALUES), list(EGG_VALUES.values()))

    def _draw_cell(self, rng: Rng, kind: str) -> str:
        block = self._cells[kind].draw(rng)
        if block == EGG:
            return f"{EGG}:{self._values.draw(rng)}"
        return block

    def _draw_grid(self, rng: Rng, kind: str, force_scatters: int = 0) -> Grid:
        grid = [[self._draw_cell(rng, kind) for _ in range(ROWS)] for _ in range(COLS)]
        placed = 0
        while placed < force_scatters:
            col, row = rng.randbelow(COLS), rng.randbelow(ROWS)
            if grid[col][row] != SCATTER:
                grid[col][row] = SCATTER
                placed += 1
        return grid

    def _fill(self, grid: Grid, rng: Rng, kind: str) -> tuple[list[int], int]:
        """Draw new cells on top of each column's survivors: new Egg values, new crystals."""
        new_eggs: list[int] = []
        new_scatters = 0
        for col in grid:
            fresh = [self._draw_cell(rng, kind) for _ in range(ROWS - len(col))]
            new_eggs.extend(egg_value(c) for c in fresh if is_egg(c))
            new_scatters += sum(c == SCATTER for c in fresh)
            col[:0] = fresh
        return new_eggs, new_scatters

    def resolve(
        self,
        rng: Rng,
        *,
        record: bool = True,
        stop_at_cap: bool = True,
        max_waves: int = MAX_WAVES,
        kind: str = "base",
        force_scatters: int = 0,
        kept: int | None = None,
        cap_units: int = DEFAULT_CAP_UNITS,
    ) -> Resolution:
        """Play one spin through all its tumbles. Pays are in 1/20 bet.

        `kept` is None in the base game. In a free spin it is the multiplier carried in: this
        spin's Eggs are added to it and the result is returned in `multiplier` (a spin without a
        win keeps the Eggs but pays nothing).
        """
        grid = self._draw_grid(rng, kind, force_scatters)
        first_grid = [list(col) for col in grid] if record else []
        waves: list[Wave] = []
        # Every Egg and crystal is counted once, when it lands; they never leave the grid.
        eggs = [egg_value(c) for col in grid for c in col if is_egg(c)]
        scatters = sum(c == SCATTER for col in grid for c in col)
        total = 0
        fill_kind = "free" if kept is not None else kind

        for _ in range(max_waves):
            counts: dict[str, int] = {}
            for col in grid:
                for cell in col:
                    if not is_egg(cell) and cell != SCATTER:
                        counts[cell] = counts.get(cell, 0) + 1
            winners = {s: n for s, n in counts.items() if n >= MIN_CLUSTER}
            if not winners:
                break

            wave_units = sum(PAYTABLE[s][tier(n)] for s, n in winners.items())
            total += wave_units
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
                waves.append(Wave(clusters, wave_units, [list(col) for col in grid]))

            if stop_at_cap and total >= cap_units:
                break
            for col_index, col in enumerate(grid):
                grid[col_index] = [cell for cell in col if cell not in winners]
            new_eggs, new_scatters = self._fill(grid, rng, fill_kind)
            eggs.extend(new_eggs)
            scatters += new_scatters

        if kept is None:
            multiplier = sum(eggs) if eggs and total > 0 else 1
            units = total * multiplier
        else:
            multiplier = kept + sum(eggs)
            units = total * max(1, multiplier) if total > 0 else 0
        # Crystals pay in the base spin only; in free spins they just extend the bonus.
        scatter_units = scatter_pay(scatters) if kept is None else 0
        units += scatter_units
        final_grid = [list(col) for col in grid] if record else []
        return Resolution(
            units, waves, eggs, multiplier, first_grid, final_grid, scatters, scatter_units
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
        left, kept, total = awarded, 0, 0
        spins: list[Resolution] = []
        retriggers: list[int] = []
        while left > 0 and len(spins) < MAX_FREE_SPINS:
            res = self.resolve(
                rng,
                record=record,
                stop_at_cap=stop_at_cap,
                kind="free",
                kept=kept,
                cap_units=cap_units,
            )
            left -= 1
            kept = res.multiplier
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
        if base.scatters < FREE_SPINS_TRIGGER:
            return base, None
        if stop_at_cap and base.units >= cap_units:
            return base, None
        return base, self.play_bonus(
            rng, FREE_SPINS_AWARD, record=record, stop_at_cap=stop_at_cap, cap_units=cap_units
        )

    @staticmethod
    def _spin_view(res: Resolution, unit: int) -> dict[str, Any]:
        return {
            "waves": [
                {
                    "grid": w.grid,
                    "clusters": [{**c, "win": c["units"] * unit} for c in w.clusters],
                    "win": w.units * unit,
                }
                for w in res.waves
            ],
            "grid": res.first_grid,
            "final_grid": res.final_grid,
            "eggs": res.eggs,
            "multiplier": res.multiplier,
            "scatters": res.scatters,
            "scatter_win": res.scatter_units * unit,
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


# --- exact first tumble ------------------------------------------------------------------------


def first_wave_rtp() -> float:
    """Exact expected pay of the first tumble alone, as a fraction of the bet (no Egg).

    The count of each block in the 30 cells is Binomial(30, p), so this needs no simulation.
    """
    total_weight = sum(WEIGHTS.values())
    expected = 0.0
    for symbol in PAYING:
        p = WEIGHTS[symbol] / total_weight
        for n in range(MIN_CLUSTER, CELLS + 1):
            expected += comb(CELLS, n) * p**n * (1 - p) ** (CELLS - n) * PAYTABLE[symbol][tier(n)]
    return expected / UNITS_PER_BET
