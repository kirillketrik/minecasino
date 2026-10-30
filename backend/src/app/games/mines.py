"""Slot «Шахта»: 5 reels x 3 rows, 20 fixed lines, Pickaxe wild, Dynamite scatter.

Rules
- Every cell is drawn independently from its reel's weights.
- A line pays left to right from reel 1 for 3, 4 or 5 matching symbols; Pickaxe (wild, reels 2-5)
  substitutes for any paying symbol. Dynamite never substitutes and breaks a line.
- 3+ Dynamite anywhere starts 10 free spins resolved in the same round. Spin k wins are
  multiplied by min(9, 2 + k): x2, x3 ... x9, x9, x9. 3+ Dynamite inside a free spin retrigger: 5
  more spins at a flat x6, up to 30 free spins in all.
- Any win leaves the round open so the player can collect or gamble it: guess the crystal colour,
  right doubles the pot, wrong burns it. The next round started by the player collects it.
- Modes (price in 1/20 of the bet): `scatter` forces at least one Dynamite onto the first spin,
  `buy_bonus` forces the 3 Dynamite that start the free spins. Both condition the same random grid
  on that event (rejection sampling), so the maths stays exact; prices are tuned by
  scripts/calibrate_mines.py so every mode returns the same 96%.
- The whole round (base spin + free spins + gambles) pays at most bet * MAX_WIN_MULTIPLIER.

All pays are whole multiples of the line bet (bet / 20) and the bet must be a multiple of 20, so
payouts are exact integers with no rounding. Gambles are 50/50 and never offered if a win would
overshoot the cap, so they do not change RTP.

`theoretical_rtp()` is the exact uncapped RTP; the cap's cost is measured by simulation
(scripts/calibrate_mines.py) and the paytable is tuned so the capped RTP lands on 96%.
"""

from dataclasses import dataclass
from math import prod
from typing import Any, ClassVar

from app.games.base import MAX_WIN_MULTIPLIER, GameResult, InvalidAction, Tuning
from app.games.rng import Rng, WeightedTable
from app.games.slot import SlotGame, SpinOutcome

COAL, IRON, GOLD, DIAMOND = "coal", "iron", "gold", "diamond"
DYNAMITE = "dynamite"  # scatter
PICKAXE = "pickaxe"  # wild
PAYING = (COAL, IRON, GOLD, DIAMOND)

REELS, ROWS = 5, 3

# Row index (0 = top) the line takes on each reel.
LINES: tuple[tuple[int, ...], ...] = (
    (1, 1, 1, 1, 1),
    (0, 0, 0, 0, 0),
    (2, 2, 2, 2, 2),
    (0, 1, 2, 1, 0),
    (2, 1, 0, 1, 2),
    (0, 0, 1, 0, 0),
    (2, 2, 1, 2, 2),
    (1, 2, 2, 2, 1),
    (1, 0, 0, 0, 1),
    (1, 2, 1, 0, 1),
    (1, 0, 1, 2, 1),
    (0, 1, 1, 1, 0),
    (2, 1, 1, 1, 2),
    (0, 1, 0, 1, 0),
    (2, 1, 2, 1, 2),
    (1, 1, 0, 1, 1),
    (1, 1, 2, 1, 1),
    (0, 0, 2, 0, 0),
    (2, 2, 0, 2, 2),
    (0, 2, 2, 2, 0),
)

# Weight of each symbol per cell on each reel. No wild on reel 1: a line never starts with one.
_BASE = {COAL: 40, IRON: 32, GOLD: 22, DIAMOND: 12, DYNAMITE: 3}
REEL_WEIGHTS: tuple[dict[str, int], ...] = (
    {**_BASE},
    {**_BASE, PICKAXE: 7},
    {**_BASE, PICKAXE: 7},
    {**_BASE, PICKAXE: 7},
    {**_BASE, PICKAXE: 7},
)

# Line-bet multiples for 3 / 4 / 5 of a kind.
PAYTABLE: dict[str, dict[int, int]] = {
    COAL: {3: 2, 4: 5, 5: 15},
    IRON: {3: 3, 4: 8, 5: 25},
    GOLD: {3: 5, 4: 13, 5: 50},
    DIAMOND: {3: 10, 4: 40, 5: 148},
}

FREE_SPINS = 10
FREE_SPIN_MULTIPLIERS = tuple(min(9, 2 + k) for k in range(FREE_SPINS))
# Retrigger: 3+ Dynamite inside a free spin add spins (up to MAX_FREE_SPINS in all), at a flat x6.
RETRIGGER_SPINS = 5
MAX_FREE_SPINS = 30
RETRIGGER_MULTIPLIER = 6


def free_multiplier(index: int) -> int:
    """Multiplier of free spin number `index` (0-based): the ladder, then flat for added spins."""
    return FREE_SPIN_MULTIPLIERS[index] if index < FREE_SPINS else RETRIGGER_MULTIPLIER


SCATTERS_FOR_BONUS = 3
MAX_GAMBLES = 5
CRYSTALS = ("red", "blue")

SCATTER_MODE, BUY_BONUS_MODE = "scatter", "buy_bonus"
# Cost in 1/20 of the bet. Bet is a multiple of 20, so the cost is always a whole number of coins.
# Measured with scripts/calibrate_mines_modes.py (80k rounds): scatter 94.8%, buy_bonus ~96%.
MODE_PRICES: dict[str, int] = {SCATTER_MODE: 29, BUY_BONUS_MODE: 905}
MODE_MIN_SCATTERS: dict[str, int] = {SCATTER_MODE: 1, BUY_BONUS_MODE: SCATTERS_FOR_BONUS}

Grid = list[list[str]]  # grid[reel][row]


@dataclass(frozen=True)
class LineWin:
    line: int
    symbol: str
    count: int
    units: int  # pay in line-bet multiples

    def view(self, line_bet: int, multiplier: int = 1) -> dict[str, Any]:
        return {
            "line": self.line,
            "symbol": self.symbol,
            "count": self.count,
            "win": self.units * line_bet * multiplier,
        }


def line_win(symbols: list[str]) -> tuple[str, int] | None:
    """Symbol and length of the winning run on one line, or None. Needs 3+ in a row."""
    target: str | None = None
    count = 0
    for sym in symbols:
        if sym == PICKAXE:
            count += 1
        elif sym == DYNAMITE:
            break
        elif target is None:
            target = sym
            count += 1
        elif sym == target:
            count += 1
        else:
            break
    if count < 3:
        return None
    # A run of nothing but wilds pays as the best symbol.
    return (target or DIAMOND), min(count, REELS)


def evaluate(grid: Grid) -> list[LineWin]:
    wins = []
    for index, rows in enumerate(LINES):
        hit = line_win([grid[reel][row] for reel, row in enumerate(rows)])
        if hit:
            symbol, count = hit
            wins.append(LineWin(index + 1, symbol, count, PAYTABLE[symbol][count]))
    return wins


def count_symbol(grid: Grid, symbol: str) -> int:
    return sum(cell == symbol for column in grid for cell in column)


def can_gamble(pot: int, gambles: int, bet: int, max_win: int = MAX_WIN_MULTIPLIER) -> bool:
    return gambles < MAX_GAMBLES and pot * 2 <= bet * max_win


class MinesGame(SlotGame):
    id: ClassVar[str] = "mines"
    units_per_bet: ClassVar[int] = len(LINES)
    min_bet: ClassVar[int] = len(LINES)
    bet_step: ClassVar[int] = len(LINES)

    modes: ClassVar[dict[str, int]] = MODE_PRICES

    def __init__(self) -> None:
        self._tables = [WeightedTable(list(w), list(w.values())) for w in REEL_WEIGHTS]

    def _draw_grid(self, rng: Rng, min_scatters: int = 0) -> Grid:
        while True:
            grid = [[table.draw(rng) for _ in range(ROWS)] for table in self._tables]
            if count_symbol(grid, DYNAMITE) >= min_scatters:
                return grid

    def spin(self, unit: int, rng: Rng, mode: str | None, tuning: Tuning) -> SpinOutcome:
        line_bet = unit

        grid = self._draw_grid(rng, MODE_MIN_SCATTERS.get(mode or "", 0))
        wins = evaluate(grid)
        total = sum(w.units for w in wins) * line_bet
        view: dict[str, Any] = {
            "grid": grid,
            "wins": [w.view(line_bet) for w in wins],
            "base_win": total,
            "free_spins": None,
        }

        if count_symbol(grid, DYNAMITE) >= SCATTERS_FOR_BONUS:
            free = []
            scheduled, index = FREE_SPINS, 0
            while index < scheduled:
                multiplier = free_multiplier(index)
                fs_grid = self._draw_grid(rng)
                fs_wins = evaluate(fs_grid)
                win = sum(w.units for w in fs_wins) * line_bet * multiplier
                total += win
                added = 0
                if (
                    count_symbol(fs_grid, DYNAMITE) >= SCATTERS_FOR_BONUS
                    and scheduled + RETRIGGER_SPINS <= MAX_FREE_SPINS
                ):
                    added = RETRIGGER_SPINS
                    scheduled += added
                free.append(
                    {
                        "grid": fs_grid,
                        "wins": [w.view(line_bet, multiplier) for w in fs_wins],
                        "multiplier": multiplier,
                        "win": win,
                        "retrigger": added,
                    }
                )
                index += 1
            view["free_spins"] = free

        return SpinOutcome(total, view)

    def settle(self, bet: int, payout: int, view: dict[str, Any], tuning: Tuning) -> GameResult:
        """A win stays open: the player collects it or gambles it."""
        if payout == 0:
            return GameResult(bet=bet, payout=0, finished=True, view=view)
        return GameResult(
            bet=bet,
            payout=0,
            finished=False,
            state={"pot": payout, "gambles": 0, "spin": view, "max_win": tuning.max_win},
            view={**view, **self._pending(payout, 0, bet, tuning.max_win)},
        )

    @staticmethod
    def _pending(pot: int, gambles: int, bet: int, max_win: int) -> dict[str, Any]:
        return {
            "pending": pot,
            "gambles": gambles,
            "can_gamble": can_gamble(pot, gambles, bet, max_win),
        }

    def act(self, state: dict[str, Any], bet: int, action: dict[str, Any], rng: Rng) -> GameResult:
        pot, gambles, spin = state["pot"], state["gambles"], state["spin"]
        max_win = state.get("max_win", MAX_WIN_MULTIPLIER)
        match action.get("type"):
            case "collect":
                return GameResult(
                    bet=bet, payout=pot, finished=True, state=state, view={**spin, "collected": pot}
                )
            case "gamble":
                color = action.get("color")
                if color not in CRYSTALS:
                    raise InvalidAction("color must be 'red' or 'blue'")
                if not can_gamble(pot, gambles, bet, max_win):
                    raise InvalidAction("gamble not available")
                crystal = CRYSTALS[rng.randbelow(2)]
                if crystal != color:
                    return GameResult(
                        bet=bet,
                        payout=0,
                        finished=True,
                        state=state,
                        view={**spin, "crystal": crystal, "lost": pot},
                    )
                pot, gambles = pot * 2, gambles + 1
                return GameResult(
                    bet=bet,
                    payout=0,
                    finished=False,
                    state={"pot": pot, "gambles": gambles, "spin": spin, "max_win": max_win},
                    view={**spin, "crystal": crystal, **self._pending(pot, gambles, bet, max_win)},
                )
            case _:
                raise InvalidAction("action must be 'collect' or 'gamble'")

    def abandon(self, state: dict[str, Any], bet: int, rng: Rng) -> GameResult | None:
        pot = state["pot"]
        view = {**state["spin"], "collected": pot, "auto_collected": True}
        return GameResult(bet=bet, payout=pot, finished=True, state=state, view=view)


# --- exact maths -------------------------------------------------------------------------------


def _probabilities(reel: int) -> dict[str, float]:
    weights = REEL_WEIGHTS[reel]
    total = sum(weights.values())
    return {sym: w / total for sym, w in weights.items()}


def line_expectation() -> float:
    """Expected pay of one line per spin, in line-bet multiples (uncapped)."""
    assert PICKAXE not in REEL_WEIGHTS[0], "a line must not start with a wild"
    probs = [_probabilities(r) for r in range(REELS)]
    wild = [p.get(PICKAXE, 0.0) for p in probs]
    expected = 0.0
    for sym in PAYING:
        match = [probs[r].get(sym, 0.0) + wild[r] for r in range(REELS)]
        head = probs[0].get(sym, 0.0)
        p3 = head * match[1] * match[2] * (1 - match[3])
        p4 = head * match[1] * match[2] * match[3] * (1 - match[4])
        p5 = head * prod(match[1:])
        expected += p3 * PAYTABLE[sym][3] + p4 * PAYTABLE[sym][4] + p5 * PAYTABLE[sym][5]
    return expected


def base_rtp() -> float:
    """Return of one plain spin as a fraction of the bet. 20 lines x (1/20 of the bet) each."""
    return line_expectation()


def trigger_probability() -> float:
    """P(3+ Dynamite among the 15 cells)."""
    dist = [1.0]  # dist[k] = P(k scatters so far)
    for r in range(REELS):
        p = _probabilities(r)[DYNAMITE]
        column = [(1 - p) ** 3, 3 * p * (1 - p) ** 2, 3 * p**2 * (1 - p), p**3]
        nxt = [0.0] * (len(dist) + ROWS)
        for i, a in enumerate(dist):
            for j, b in enumerate(column):
                nxt[i + j] += a * b
        dist = nxt
    return sum(dist[SCATTERS_FOR_BONUS:])


def theoretical_rtp() -> float:
    """Exact RTP ignoring the 100x cap (which only lowers it)."""
    t = trigger_probability()
    # Expected sum of free-spin multipliers: walk the spins, tracking how many are scheduled.
    dist = {FREE_SPINS: 1.0}
    expected = 0.0
    for k in range(MAX_FREE_SPINS):
        nxt: dict[int, float] = {}
        for scheduled, p in dist.items():
            if k >= scheduled:
                continue
            expected += p * free_multiplier(k)
            more = scheduled + RETRIGGER_SPINS
            grown = more if more <= MAX_FREE_SPINS else scheduled
            nxt[grown] = nxt.get(grown, 0.0) + p * t
            nxt[scheduled] = nxt.get(scheduled, 0.0) + p * (1 - t)
        dist = nxt
    return base_rtp() * (1 + t * expected)
