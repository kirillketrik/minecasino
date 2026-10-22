"""Tiny games with known math, used to test the engine, service, API and simulator."""

from typing import Any

from app.games.base import Game, GameResult, InvalidAction
from app.games.rng import Rng


class FlipGame(Game):
    """Single spin. Wins 1.92x with probability 0.5, so RTP = 0.96."""

    id = "test_flip"

    def __init__(self, win_chance: float = 0.5, multiplier: float = 1.92) -> None:
        self.win_chance = win_chance
        self.multiplier = multiplier

    def start(self, bet: int, rng: Rng) -> GameResult:
        win = rng.random() < self.win_chance
        payout = int(bet * self.multiplier) if win else 0
        return GameResult(bet=bet, payout=payout, finished=True, view={"win": win})


class JackpotGame(Game):
    """Rarely pays 1000x (raw RTP 0.96), so the 100x cap must bite."""

    id = "test_jackpot"
    chance = 0.00096

    def start(self, bet: int, rng: Rng) -> GameResult:
        win = rng.random() < self.chance
        return GameResult(bet=bet, payout=bet * 1000 if win else 0, finished=True)


class LadderGame(Game):
    """Stays open. `flip` doubles the pot or loses it (50/50); `collect` banks it."""

    id = "test_ladder"

    def start(self, bet: int, rng: Rng) -> GameResult:
        return GameResult(
            bet=bet,
            payout=0,
            finished=False,
            state={"pot": bet, "secret": "hidden"},
            view={"pot": bet},
        )

    def act(self, state: dict[str, Any], bet: int, action: dict[str, Any], rng: Rng) -> GameResult:
        pot = state["pot"]
        match action.get("type"):
            case "flip":
                if rng.random() < 0.5:
                    pot *= 2
                    return GameResult(
                        bet=bet,
                        payout=0,
                        finished=False,
                        state={**state, "pot": pot},
                        view={"pot": pot},
                    )
                return GameResult(bet=bet, payout=0, finished=True, state=state, view={"pot": 0})
            case "collect":
                return GameResult(
                    bet=bet, payout=pot, finished=True, state=state, view={"pot": pot}
                )
            case _:
                raise InvalidAction("unknown action")


class AlwaysWinRng:
    """Stands in for Rng where every `random()` draw is the lowest possible value."""

    def random(self) -> float:
        return 0.0

    def randbelow(self, n: int) -> int:
        return 0
