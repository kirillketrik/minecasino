"""«Элитры» (crash): the multiplier climbs with time until it crashes; cash out before that.

Rules
- Each round is the player's own: the crash point is drawn when the round opens and kept in the
  private state. Nobody else's flight influences it.
- The multiplier follows m(t) = exp(GROWTH * t), in whole hundredths (x100). It comes from the
  server clock: the client only draws the curve, the server decides if a cash-out is in time.
- Crash point: floor(96 / (1 - u)) hundredths for uniform u. Anything below 1.00x busts at
  once, and the point is capped at MAX_WIN_MULTIPLIER (reaching the cap pays it automatically).
- Cashing out at m hundredths pays bet * m // 100 when m <= crash point. For every m in
  [101, 10000], P(crash point >= m) = 96 / m, so a player who always cashes out at m has an
  expected return of exactly 96% whatever m is. Walking away is a bust. A cash-out below 1.01x is
  refused, because 1.00x would be a free refund and break the 96% return.
- The payout rounds down to a whole coin.
"""

import math
import time
from collections.abc import Callable
from typing import Any, ClassVar

from app.games.base import MAX_WIN_MULTIPLIER, TARGET_RTP, Game, GameResult, InvalidAction
from app.games.rng import Rng

GROWTH = 0.1  # per second: 2x after ~7s, 10x after ~23s, the 100x cap after ~46s
SCALE = 100  # multipliers are integers in hundredths
MIN_CASHOUT = 101
CAP = MAX_WIN_MULTIPLIER * SCALE
_N = 2**53  # resolution of the uniform draw
_NUMERATOR = round(TARGET_RTP * SCALE)  # 96


def draw_crash_point(rng: Rng) -> int:
    """Crash point in hundredths, capped. Below SCALE means the flight ends before it starts."""
    r = rng.randbelow(_N)
    return min(CAP, _NUMERATOR * _N // (_N - r))


def win_probability(multiplier: int) -> float:
    """Exact P(crash point >= multiplier) for multiplier in hundredths, 100 <= m <= CAP."""
    return min(_N, _NUMERATOR * _N // multiplier) / _N


def multiplier_at(elapsed: float) -> int:
    """The multiplier shown `elapsed` seconds after take-off, in hundredths, capped."""
    if elapsed <= 0:
        return SCALE
    if elapsed >= time_to(CAP):  # also keeps exp() from overflowing on stale rounds
        return CAP
    return min(CAP, int(SCALE * math.exp(GROWTH * elapsed)))


def time_to(multiplier: int) -> float:
    """Seconds after take-off at which the multiplier first reaches `multiplier` hundredths."""
    return math.log(multiplier / SCALE) / GROWTH


class ElytraGame(Game):
    id: ClassVar[str] = "elytra"

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock

    # --- helpers used by the WebSocket stream (state is private, so only the server calls them) --

    def current_multiplier(self, state: dict[str, Any]) -> int:
        return multiplier_at(self._clock() - state["started_at"])

    def multiplier_for(self, state: dict[str, Any], now: float) -> int:
        return multiplier_at(now - state["started_at"])

    def is_over(self, state: dict[str, Any], multiplier: int) -> bool:
        """The rocket has crashed, or reached the cap and is paid automatically."""
        return multiplier > state["crash"] or (state["crash"] >= CAP and multiplier >= CAP)

    def settle_at(self, state: dict[str, Any]) -> float:
        """Server time when the flight ends by itself: the crash, or the cap being reached."""
        crash = state["crash"]
        target = CAP if crash >= CAP else crash + 1
        return state["started_at"] + time_to(target)

    # --- Game ------------------------------------------------------------------------------------

    def start(self, bet: int, rng: Rng) -> GameResult:
        crash = draw_crash_point(rng)
        now = self._clock()
        if crash < SCALE:
            return GameResult(
                bet, 0, True, {"crash": crash, "started_at": now}, _finished_view("crashed", crash)
            )
        state = {"crash": crash, "started_at": now}
        view = {
            "status": "flying",
            "started_at": now,
            "server_time": now,
            "growth": GROWTH,
            "min_cashout": MIN_CASHOUT,
            "max_multiplier": CAP,
        }
        return GameResult(bet, 0, False, state, view)

    def act(self, state: dict[str, Any], bet: int, action: dict[str, Any], rng: Rng) -> GameResult:
        if action.get("type") != "cashout":
            raise InvalidAction("Unknown action")
        crash = state["crash"]
        m = self.current_multiplier(state)
        if m > crash:
            return GameResult(bet, 0, True, state, _finished_view("crashed", crash))
        if m < MIN_CASHOUT:
            raise InvalidAction("Too early to cash out")
        view = _finished_view("cashed_out", crash) | {"cashout": m}
        return GameResult(bet, bet * m // SCALE, True, state, view)

    def abandon(self, state: dict[str, Any], bet: int, rng: Rng) -> GameResult | None:
        """Walking away mid-flight forfeits the bet, unless the flight had already hit the cap."""
        crash = state["crash"]
        if crash >= CAP and self.current_multiplier(state) >= CAP:
            view = _finished_view("cashed_out", crash) | {"cashout": CAP}
            return GameResult(bet, bet * CAP // SCALE, True, state, view)
        return GameResult(bet, 0, True, state, _finished_view("crashed", crash))


def _finished_view(status: str, crash: int) -> dict[str, Any]:
    return {"status": status, "crash_point": crash}
