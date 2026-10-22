"""Monte-Carlo harness used to calibrate and verify each game's RTP.

Results go through `engine.finalize`, so the numbers include the production win cap.
RTP is judged with a z-score against the sample's own standard error instead of a fixed
tolerance: a rare big win makes the estimate noisier and the bar looser, as it should.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.games.base import Game, GameResult
from app.games.engine import finalize
from app.games.rng import Rng

# (game, state, bet, rng) -> action to play next. Used for games that stay open after `start`.
Policy = Callable[[Game, dict[str, Any], int, Rng], dict[str, Any]]


@dataclass(frozen=True)
class SimReport:
    rounds: int
    rtp: float
    stderr: float
    hit_rate: float
    max_multiplier: float
    capped_rounds: int

    def z_score(self, target_rtp: float) -> float:
        return (self.rtp - target_rtp) / self.stderr if self.stderr else math.inf


def simulate(
    game: Game,
    rng: Rng,
    rounds: int,
    *,
    bet: int = 100,
    max_multiplier: int = 100,
    policy: Policy | None = None,
    max_steps: int = 1000,
) -> SimReport:
    total = total_sq = 0.0
    hits = capped = 0
    top = 0.0
    for _ in range(rounds):
        raw = game.start(bet, rng)
        result = _play_out(game, raw, rng, bet, max_multiplier, policy, max_steps)
        ret = result.payout / bet
        total += ret
        total_sq += ret * ret
        hits += result.payout > 0
        capped += bool(result.view.get("capped"))
        top = max(top, ret)

    mean = total / rounds
    variance = max(total_sq / rounds - mean * mean, 0.0) * rounds / (rounds - 1)
    return SimReport(
        rounds=rounds,
        rtp=mean,
        stderr=math.sqrt(variance / rounds),
        hit_rate=hits / rounds,
        max_multiplier=top,
        capped_rounds=capped,
    )


def _play_out(
    game: Game,
    result: GameResult,
    rng: Rng,
    bet: int,
    max_multiplier: int,
    policy: Policy | None,
    max_steps: int,
) -> GameResult:
    result = finalize(result, max_multiplier)
    steps = 0
    while not result.finished:
        if policy is None or steps >= max_steps:
            raise RuntimeError(f"{game.id}: round still open and no policy to finish it")
        action = policy(game, result.state, bet, rng)
        result = finalize(game.act(result.state, bet, action, rng), max_multiplier)
        steps += 1
    return result
