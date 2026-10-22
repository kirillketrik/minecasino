"""Price the play modes of «Крипер» so each returns 96%.

    uv run python scripts/calibrate_creeper_modes.py [rounds] [seed]

The price is (average capped pay of the mode, in bets) / TARGET_RTP. Prints it in 1/20 of the bet,
as MODE_PRICES wants it.
"""

import multiprocessing as mp
import sys

from app.games import creeper
from app.games.base import MAX_WIN_MULTIPLIER, TARGET_RTP
from app.games.rng import seeded_rng

CAP_UNITS = MAX_WIN_MULTIPLIER * creeper.UNITS_PER_BET


def work(args: tuple[str, int, int]) -> tuple[float, float, int, int]:
    mode, seed, rounds = args
    game, rng = creeper.CreeperGame(), seeded_rng(seed)
    total = total_sq = 0.0
    triggers = capped = 0
    for _ in range(rounds):
        base, bonus = game.play(rng, mode, record=False, stop_at_cap=False)
        units = base.units + (bonus.units if bonus else 0)
        value = min(units, CAP_UNITS) / creeper.UNITS_PER_BET
        total += value
        total_sq += value * value
        triggers += bonus is not None
        capped += units >= CAP_UNITS
    return total, total_sq, triggers, capped


def main() -> None:
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 400_000
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    procs = mp.cpu_count()
    per = rounds // procs
    only = sys.argv[3:]
    for mode in (creeper.ANTE_MODE, creeper.BUY_BONUS_MODE):
        if only and mode not in only:
            continue
        with mp.Pool(procs) as pool:
            parts = pool.map(work, [(mode, seed * 1000 + i, per) for i in range(procs)])
        n = per * procs
        mean = sum(p[0] for p in parts) / n
        sd = (sum(p[1] for p in parts) / n - mean * mean) ** 0.5
        price = mean / TARGET_RTP
        current = creeper.MODE_PRICES[mode] / 20
        print(
            f"{mode:10} pays {mean:8.3f} bets (s.e. {sd / n**0.5:.3f}) -> price {price:8.3f} bets "
            f"= {round(price * 20)} twentieths | current {current:.2f} bets, "
            f"RTP {mean / current:.4f} | bonus every {n / max(1, sum(p[2] for p in parts)):.0f} "
            f"| capped {sum(p[3] for p in parts)}"
        )


if __name__ == "__main__":
    main()
