"""Price the play modes of «Шахта» so each returns 96%.

    uv run python scripts/calibrate_mines_modes.py [rounds] [seed]

The mode price is (average capped pay of the mode, in bets) / TARGET_RTP, so the player's return
is the same whichever way they play. Prints the price in 1/20 of the bet, as MODE_PRICES wants it.
"""

import sys

from app.games import mines
from app.games.base import TARGET_RTP
from app.games.rng import seeded_rng

BET = 1000


def main() -> None:
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 20_000
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    game = mines.MinesGame()
    for mode in (mines.SCATTER_MODE, mines.BUY_BONUS_MODE):
        rng = seeded_rng(seed)
        pots = []
        for _ in range(rounds):
            r = game.start(BET, rng, mode)
            pots.append(r.state["pot"] if not r.finished else 0)
        mean = sum(pots) / rounds / BET
        price = mean / TARGET_RTP
        current = mines.MODE_PRICES[mode] / 20
        print(
            f"{mode:10} pays {mean:7.3f} bets  -> price {price:7.3f} bets "
            f"= {round(price * 20)} twentieths | current {current:.2f} bets, "
            f"RTP {mean / current:.4f} | hit {sum(p > 0 for p in pots) / rounds:.3f} "
            f"| max {max(pots) / BET:.0f}x"
        )


if __name__ == "__main__":
    main()
