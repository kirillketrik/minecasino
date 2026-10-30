"""Measure the RTP of «Бурение» and price its ante mode.

    uv run python scripts/calibrate_drill.py [rounds] [seed]

Prints the average capped pay of the plain game and of the ante mode (in bets), the hit rate and
the price of the ante mode that keeps it at TARGET_RTP, in 1/20 of the bet as MODE_PRICES wants it.
"""

import sys

from app.games import drill
from app.games.base import MAX_WIN_MULTIPLIER, TARGET_RTP
from app.games.rng import seeded_rng

CAP = MAX_WIN_MULTIPLIER * drill.UNITS_PER_BET


def measure(kind: str, rounds: int, seed: int) -> None:
    game, rng = drill.DrillGame(), seeded_rng(seed)
    total = total_sq = 0.0
    hits = capped = cleared = 0
    for _ in range(rounds):
        d = game.dig(rng, kind)
        value = min(d.units, CAP) / drill.UNITS_PER_BET
        total += value
        total_sq += value * value
        hits += d.units > 0
        capped += d.units >= CAP
        cleared += d.cleared
    mean = total / rounds
    se = ((total_sq / rounds - mean * mean) / rounds) ** 0.5
    print(f"--- {kind}")
    print(f"avg capped pay   {mean:.4f} bets +/- {se:.4f}")
    print(f"hit rate         {hits / rounds:.3f}")
    print(f"mine cleared     {cleared / rounds:.4f}")
    print(f"at the cap       {capped} of {rounds}")
    if kind != "base":
        print(f"price for {TARGET_RTP:.0%}: {mean / TARGET_RTP * 20:.1f} (1/20 bet)")


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 1_000_000
    s = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    measure("base", n, s)
    measure("ante", n, s)
