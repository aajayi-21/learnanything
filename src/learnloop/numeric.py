from __future__ import annotations

import math
from typing import Sequence


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def sigmoid(x: float) -> float:
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    z = math.exp(x)
    return z / (1.0 + z)


def empirical_quantile(values: Sequence[float], q: float) -> float:
    """Linear-interpolation empirical quantile (matches numpy's 'linear' method)."""
    if not values:
        raise ValueError("empirical_quantile requires at least one value")
    if not 0.0 <= q <= 1.0:
        raise ValueError(f"quantile must be in [0, 1], got {q}")
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = q * (len(ordered) - 1)
    lower = math.floor(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


def percentiles(
    values: Sequence[float], qs: Sequence[float] = (0.10, 0.25, 0.50, 0.75, 0.90)
) -> dict[float, float]:
    if not values:
        return {}
    ordered = sorted(values)
    return {q: empirical_quantile(ordered, q) for q in qs}
