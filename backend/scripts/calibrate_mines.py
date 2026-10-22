"""Report the RTP of «Шахта»: exact uncapped value, cost of the 100x cap, and the result.

    uv run python scripts/calibrate_mines.py [rounds] [seed]

The cap cost is measured on identical random draws with and without the cap, so its error is
tiny compared with a plain simulation of the whole RTP.
"""

import sys
import time

from app.games import mines
from app.games.rng import seeded_rng

BET = 1000


def pots(rounds: int, seed: int) -> list[int]:
    game, rng = mines.MinesGame(), seeded_rng(seed)
    out = []
    for _ in range(rounds):
        r = game.start(BET, rng)
        out.append(r.state["pot"] if not r.finished else 0)
    return out


def main() -> None:
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 300_000
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    t0 = time.time()
    capped = pots(rounds, seed)
    cap_value = mines.MAX_WIN_MULTIPLIER
    mines.MAX_WIN_MULTIPLIER = 10**9
    try:
        uncapped = pots(rounds, seed)
    finally:
        mines.MAX_WIN_MULTIPLIER = cap_value

    hit_cap = sum(u > c for u, c in zip(uncapped, capped, strict=True))
    loss = sum(u - c for u, c in zip(uncapped, capped, strict=True)) / rounds / BET
    exact = mines.theoretical_rtp()
    sim_capped = sum(capped) / rounds / BET
    sim_uncapped = sum(uncapped) / rounds / BET
    print(f"base spin RTP        {mines.base_rtp():.4f}")
    print(f"bonus trigger        1 in {1 / mines.trigger_probability():.1f}")
    print(f"exact uncapped RTP   {exact:.4f}")
    print(f"cap cost (measured)  {loss:.4f}  ({hit_cap} capped rounds)")
    print(f"=> RTP with cap      {exact - loss:.4f}")
    print(f"sim uncapped / capped {sim_uncapped:.4f} / {sim_capped:.4f}   (noisy)")
    print(f"hit rate             {sum(c > 0 for c in capped) / rounds:.3f}")
    print(f"max win              {max(capped) / BET:.0f}x")
    print(f"{rounds} rounds in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
