"""Measure the RTP of «Крипер» on all CPU cores.

    uv run python scripts/calibrate_creeper.py [rounds] [seed]

Cascades have no closed form, so RTP comes from simulation. Cascade paths depend only on the
weights, never on the paytable, so RTP is linear in the pays: if the result is off, scale the
paytable by target / measured, round to integers and measure again. Pays are totalled before the
cap and clamped to it afterwards, which is exactly what the game pays (it stops cascading once the
cap is reached).
"""

import multiprocessing as mp
import sys
import time

from app.games import creeper
from app.games.base import MAX_WIN_MULTIPLIER
from app.games.rng import seeded_rng

CAP_UNITS = MAX_WIN_MULTIPLIER * creeper.UNITS_PER_BET


def work(args: tuple[int, int]) -> tuple[float, float, int, int, int, int, float]:
    seed, rounds = args
    game, rng = creeper.CreeperGame(), seeded_rng(seed)
    total = total_sq = bonus_units = 0.0
    hits = capped = triggers = 0
    for _ in range(rounds):
        base, bonus = game.play(rng, None, record=False, stop_at_cap=False)
        units = base.units + (bonus.units if bonus else 0)
        triggers += bonus is not None
        bonus_units += min(bonus.units, CAP_UNITS) if bonus else 0
        value = min(units, CAP_UNITS) / creeper.UNITS_PER_BET
        total += value
        total_sq += value * value
        hits += units > 0
        capped += units >= CAP_UNITS
    return total, total_sq, hits, capped, rounds, triggers, bonus_units / creeper.UNITS_PER_BET


def main() -> None:
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 6_000_000
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    procs = mp.cpu_count()
    started = time.time()
    with mp.Pool(procs) as pool:
        parts = pool.map(work, [(seed * 1000 + i, rounds // procs) for i in range(procs)])

    n = sum(p[4] for p in parts)
    triggers = sum(p[5] for p in parts)
    mean = sum(p[0] for p in parts) / n
    variance = sum(p[1] for p in parts) / n - mean * mean
    print(f"first wave only      {creeper.first_wave_rtp():.4f}  (exact)")
    print(f"RTP                  {mean:.4f}  +/- {(variance / n) ** 0.5:.4f}  (1 s.e.)")
    print(f"bonus share of RTP {sum(p[6] for p in parts) / n:.4f}")
    print(f"bonus every          {n / max(1, triggers):.0f} spins")
    print(f"hit rate             {sum(p[2] for p in parts) / n:.3f}")
    print(f"rounds at the cap    {sum(p[3] for p in parts)} of {n}")
    print(f"std dev per round    {variance**0.5:.2f} x bet")
    print(f"{n} rounds in {time.time() - started:.0f}s on {procs} processes")


if __name__ == "__main__":
    main()
