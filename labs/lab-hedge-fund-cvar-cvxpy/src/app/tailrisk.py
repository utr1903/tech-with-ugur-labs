"""Tail-risk arithmetic in plain NumPy, with no optimizer anywhere near it.

Everything the lab reports about a portfolio's tail is recomputed through
this module from the weights and the scenario matrix alone. Keeping it free
of CVXPY is the point: the numbers that check the solver must not come from
the solver.

A *loss* here is the negative of a portfolio return, so a loss of `0.04`
means the book was down four percent of NAV in that scenario. VaR at level
`beta` is the smallest loss that the worst `(1 - beta)` share of scenarios
exceeds or matches; CVaR is the average loss over that same worst share.
CVaR is therefore never below VaR, and it is the number the model
minimizes because, unlike VaR, it is convex in the weights.
"""

from __future__ import annotations

import hashlib
import math
from typing import Any

import numpy as np
import numpy.typing as npt

from app.contracts import FloatArray, TailStatistics
from app.errors import MarketError, ScenarioError

# Decimal places the tail share is snapped to before its ceiling is taken,
# so a share that is a whole number in exact arithmetic stays one.
_TAIL_DECIMALS = 9


def portfolio_losses(returns: FloatArray, weights: FloatArray) -> FloatArray:
    """Project a `[S, N]` return matrix onto `weights` and negate it.

    Args:
        returns: One-month simple returns, one row per scenario.
        weights: Signed fractions of NAV, one entry per name.

    Returns:
        A length-`S` loss vector, `-(returns @ weights)`.

    Raises:
        MarketError: If the two shapes cannot be multiplied.
    """
    if returns.ndim != 2:
        raise MarketError(f"returns must be a 2-D [S, N] matrix, got {returns.shape}")
    if weights.ndim != 1 or weights.shape[0] != returns.shape[1]:
        raise MarketError(
            f"weights must have one entry per column of returns; "
            f"returns is {returns.shape} and weights is {weights.shape}"
        )
    return -(returns @ weights)


def tail_statistics(losses: FloatArray, beta: float) -> TailStatistics:
    """Compute the empirical VaR and CVaR of `losses` at confidence `beta`.

    With `S` scenarios and `k = ceil((1 - beta) * S)`, the tail is the `k`
    largest losses. VaR is the smallest of them and CVaR is their mean, so
    both are read straight off the sorted sample with no interpolation and
    no distributional assumption.

    `(1 - beta) * S` is snapped to nine decimals before the ceiling is
    taken. That is not cosmetic: in binary floating point `1 - 0.95` is
    `0.05000000000000004`, so the 95% tail of 10,000 scenarios would come
    out as 501 rather than 500 and the lab's exactness claim — that the
    linear program's optimum equals the average of the worst `k` losses
    when `(1 - beta) * S` is a whole number — would miss by one scenario.

    Args:
        losses: A one-dimensional loss sample.
        beta: Confidence level, strictly between 0 and 1.

    Returns:
        The VaR, the CVaR and the number of scenarios averaged.

    Raises:
        MarketError: If `losses` is not a non-empty one-dimensional array.
        ScenarioError: If `beta` is outside `(0, 1)`.
    """
    if losses.ndim != 1 or losses.size == 0:
        raise MarketError(f"losses must be a non-empty 1-D array, got {losses.shape}")
    if not 0.0 < beta < 1.0:
        raise ScenarioError(f"cvar_beta must lie strictly inside (0, 1), got {beta}")

    count = losses.shape[0]
    # The clamp is reachable only through the snapping above: a tail share
    # below 1e-9 rounds to zero, and an empty tail has no VaR to report.
    tail_count = max(1, math.ceil(round((1.0 - beta) * count, _TAIL_DECIMALS)))
    tail = np.sort(losses)[count - tail_count :]
    return TailStatistics(
        var=float(tail[0]), cvar=float(tail.mean()), tail_count=tail_count
    )


def weight_distance(left: FloatArray, right: FloatArray) -> float:
    """Return the L1 distance between two weight vectors.

    L1 rather than L2 because a portfolio difference is read as "how much
    notional would have to trade to get from one book to the other", and
    that is a sum of absolute per-name differences.

    Raises:
        MarketError: If the two vectors are not the same one-dimensional
            shape.
    """
    if left.ndim != 1 or left.shape != right.shape:
        raise MarketError(
            f"weight vectors must share one shape, got {left.shape} and {right.shape}"
        )
    return float(np.abs(left - right).sum())


def array_digest(array: npt.NDArray[Any]) -> str:
    """Return a sha256 digest over an array's shape, dtype and bytes.

    Two runs that print the same digest drew exactly the same numbers, which
    is how the lab shows that a seeded generator is reproducible without
    committing the matrix itself.

    The dtype is hashed alongside the bytes, so the same values stored at a
    different precision do not collide. Any dtype is accepted for that
    reason: the digest is a fingerprint of the array as stored, not a claim
    about what is in it.
    """
    digest = hashlib.sha256(f"{array.shape}|{array.dtype}".encode())
    digest.update(np.ascontiguousarray(array).tobytes())
    return digest.hexdigest()
