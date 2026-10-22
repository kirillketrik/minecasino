"""Rules applied to every game result, in one place."""

from dataclasses import replace

from app.games.base import GameResult


def cap_payout(bet: int, payout: int, max_multiplier: int) -> int:
    """Clamp a payout to [0, bet * max_multiplier]."""
    return max(0, min(payout, bet * max_multiplier))


def finalize(result: GameResult, max_multiplier: int) -> GameResult:
    """Enforce the win cap and the 'pay only when finished' rule on a game's raw result."""
    if not result.finished:
        return replace(result, payout=0)
    capped = cap_payout(result.bet, result.payout, max_multiplier)
    if capped == result.payout:
        return result
    return replace(result, payout=capped, view={**result.view, "capped": True})
