"""Measure the real RTP of every slot at the default tuning, on all CPU cores.

    uv run python scripts/measure_rtp.py [rounds] [seed]
"""

import math
import multiprocessing as mp
import sys
import time

from app.games import registry
from app.games.base import Tuning
from app.games.catalog import register_all
from app.games.rng import seeded_rng
from app.games.simulation import simulate

GAMES = ("mines", "creeper", "ender", "drill")


def work(args: tuple[str, int, int]) -> tuple[int, float, float, float, float, int]:
    game_id, seed, rounds = args
    register_all()
    game = registry.get_game(game_id)
    r = simulate(
        game, seeded_rng(seed), rounds, bet=100, tuning=Tuning(), policy=lambda *_: {"type": "collect"}
    )
    mean = r.rtp
    var = (r.stderr**2) * rounds
    return rounds, mean, var, r.hit_rate, r.max_multiplier, r.capped_rounds


def main() -> None:
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 2_000_000
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    procs = mp.cpu_count()
    start = time.time()
    with mp.Pool(procs) as pool:
        for game_id in GAMES:
            parts = pool.map(work, [(game_id, seed * 1000 + i, rounds // procs) for i in range(procs)])
            n = sum(p[0] for p in parts)
            mean = sum(p[0] * p[1] for p in parts) / n
            var = sum(p[0] * p[2] for p in parts) / n
            se = math.sqrt(var / n)
            print(
                f"{game_id:8} n={n}  RTP {mean * 100:.2f}% +/- {se * 100:.2f} (1 s.e.)  "
                f"hit {sum(p[0] * p[3] for p in parts) / n * 100:.1f}%  "
                f"max x{max(p[4] for p in parts):.0f}  capped {sum(p[5] for p in parts)}",
                flush=True,
            )
    print(f"done in {time.time() - start:.0f}s")


if __name__ == "__main__":
    main()
