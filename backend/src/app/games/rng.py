"""Randomness for games. Production uses the OS CSPRNG; tests and simulations use a seed."""

import random
from bisect import bisect_right
from collections.abc import Sequence
from itertools import accumulate


class Rng:
    """Thin wrapper so games depend on three primitives and tests can swap the source."""

    def __init__(self, source: random.Random) -> None:
        self._source = source

    def random(self) -> float:
        """Uniform float in [0, 1)."""
        return self._source.random()

    def randbelow(self, n: int) -> int:
        """Uniform integer in [0, n)."""
        return self._source.randrange(n)

    def weighted_index(self, weights: Sequence[int]) -> int:
        """Index drawn with probability weights[i] / sum(weights). Weights are integers."""
        return WeightedTable(range(len(weights)), weights).draw(self)


def secure_rng() -> Rng:
    return Rng(random.SystemRandom())


def seeded_rng(seed: int) -> Rng:
    """Deterministic and predictable: for tests and simulations only, never for real rounds."""
    return Rng(random.Random(seed))


class WeightedTable[T]:
    """Symbols with integer weights. Integer weights keep probabilities exact."""

    def __init__(self, items: Sequence[T], weights: Sequence[int]) -> None:
        if len(items) != len(weights) or not items:
            raise ValueError("items and weights must be non-empty and equally long")
        if any(w < 0 for w in weights) or sum(weights) == 0:
            raise ValueError("weights must be non-negative with a positive sum")
        self.items = list(items)
        self.weights = list(weights)
        self._cumulative = list(accumulate(weights))
        self.total = self._cumulative[-1]

    def draw(self, rng: Rng) -> T:
        return self.items[bisect_right(self._cumulative, rng.randbelow(self.total))]

    def probability(self, item: T) -> float:
        return (
            sum(w for i, w in zip(self.items, self.weights, strict=True) if i == item) / self.total
        )
