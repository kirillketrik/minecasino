"""Measure the RTP of «Врата Края» on all CPU cores, and price its play modes.

    uv run python scripts/calibrate_ender.py [rounds] [seed]

Tumble paths depend only on the weights, never on the paytable, so RTP is linear in the pays: if
the result is off, scale the paytable by target / measured, round to integers and measure again.
Pays are totalled before the cap and clamped to it afterwards, which is exactly what the game pays
(it stops tumbling once the cap is reached).

Prices of the modes are (average capped pay of the mode, in bets) / TARGET_RTP, printed in 1/20 of
the bet as MODE_PRICES wants it.
"""

import multiprocessing as mp
import sys
import time

from app.games import ender
from app.games.base import MAX_WIN_MULTIPLIER, TARGET_RTP
from app.games.rng import seeded_rng

CAP_UNITS = MAX_WIN_MULTIPLIER * ender.UNITS_PER_BET
MODES = (None, ender.ANTE_MODE, ender.BUY_BONUS_MODE)


def work(args: tuple[str | None, int, int]) -> tuple[float, float, int, int, int, int, float]:
    mode, seed, rounds = args
    game, rng = ender.EnderGame(), seeded_rng(seed)
    total = total_sq = bonus_units = 0.0
    hits = capped = triggers = 0
    for _ in range(rounds):
        base, bonus = game.play(rng, mode, record=False, stop_at_cap=False)
        units = base.units + (bonus.units if bonus else 0)
        triggers += bonus is not None
        bonus_units += min(bonus.units, CAP_UNITS) if bonus else 0
        value = min(units, CAP_UNITS) / ender.UNITS_PER_BET
        total += value
        total_sq += value * value
        hits += units > 0
        capped += units >= CAP_UNITS
    return total, total_sq, hits, capped, rounds, triggers, bonus_units / ender.UNITS_PER_BET


def measure(pool, mode: str | None, rounds: int, seed: int) -> dict[str, float]:
    procs = mp.cpu_count()
    parts = pool.map(work, [(mode, seed * 1000 + i, rounds // procs) for i in range(procs)])
    n = sum(p[4] for p in parts)
    mean = sum(p[0] for p in parts) / n
    variance = sum(p[1] for p in parts) / n - mean * mean
    return {
        "n": n,
        "rtp": mean,
        "se": (variance / n) ** 0.5,
        "bonus_share": sum(p[6] for p in parts) / n,
        "bonus_every": n / max(1, sum(p[5] for p in parts)),
        "hit": sum(p[2] for p in parts) / n,
        "capped": sum(p[3] for p in parts),
        "sd": variance**0.5,
    }


def main() -> None:
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 4_000_000
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    started = time.time()
    with mp.Pool(mp.cpu_count()) as pool:
        print(f"first tumble only    {ender.first_wave_rtp():.4f}  (exact)")
        for mode in MODES:
            m = measure(pool, mode, rounds, seed)
            print(f"--- mode {mode or 'plain'}")
            print(f"avg capped pay       {m['rtp']:.4f} bets  +/- {m['se']:.4f}  (1 s.e.)")
            print(f"bonus share          {m['bonus_share']:.4f}")
            print(f"bonus every          {m['bonus_every']:.0f} spins")
            print(f"hit rate             {m['hit']:.3f}")
            print(f"rounds at the cap    {m['capped']} of {m['n']}")
            print(f"std dev per round    {m['sd']:.2f} x bet")
            if mode:
                print(f"price for {TARGET_RTP:.0%}: {m['rtp'] / TARGET_RTP * 20:.1f} (1/20 bet)")
    print(f"done in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
