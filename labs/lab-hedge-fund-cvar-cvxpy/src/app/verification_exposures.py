"""Everything the verifier recomputes, in plain NumPy, from `w` alone.

No function here takes a solved model, a constraint or a solver leg. They
take the universe, the return matrix and a weight vector, and they rebuild
the reported numbers from scratch. That is the whole discipline of the
verification pass: a check fed the solver's own expressions can only ever
confirm that the solver agrees with itself.

The two costs are where the discipline bites hardest. `model_desk.py`
charges borrow on the short *leg* `s` and trading cost on the turnover
*leg* `t`, and both legs are relaxations — `s >= max(-w, 0)` and
`t >= |w - w0|`, with equality only at an optimum where something pushes
them down. The recomputation below uses `max(-w, 0)` and `|w - w0|`
directly. So the reported cost is the true cost of the book, the model's
cost is an upper bound on it, and the gap between them is exactly the
relaxation slack that `relaxation_exact` is there to bound.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.contracts import FloatArray, Universe
from app.tailrisk import tail_count

# Borrow is quoted annually and charged over a one-month horizon. The same
# constant appears in `model_desk.py`; it is written out again here rather
# than imported, because importing it would tie the verifier to the module
# whose arithmetic it exists to check.
MONTHS_PER_YEAR = 12.0


@dataclass(frozen=True)
class DeskExposures:
    """Every mandate quantity, rebuilt from the weight vector."""

    gross_leverage: float
    net_exposure: float
    portfolio_beta: float
    turnover: float
    name_gross_max: float
    sector_net: FloatArray
    sector_gross: FloatArray


@dataclass(frozen=True)
class CostLedger:
    """What the book earns and what it pays, before and after costs."""

    expected_gross_return: float
    borrow_cost: float
    trading_cost: float
    expected_net_return: float


def desk_exposures(universe: Universe, weights: FloatArray) -> DeskExposures:
    """Recompute every desk exposure from the weights and the sector map.

    Args:
        universe: Names, betas, the `[K, N]` sector indicator and `w0`.
        weights: Signed fractions of NAV, one per name.

    Returns:
        The seven numbers the desk mandate is written in terms of.
    """
    absolute = np.abs(weights)
    traded = np.abs(weights - universe.start_book)
    return DeskExposures(
        gross_leverage=float(absolute.sum()),
        net_exposure=float(weights.sum()),
        portfolio_beta=float(universe.market_beta @ weights),
        turnover=float(traded.sum()),
        name_gross_max=float(absolute.max()),
        sector_net=universe.sector_matrix @ weights,
        sector_gross=universe.sector_matrix @ absolute,
    )


def cost_ledger(
    universe: Universe, returns: FloatArray, weights: FloatArray
) -> CostLedger:
    """Price the book on the sample it was optimized against.

    The expected return is the *sample* mean of the drawn matrix, not the
    universe's `expected_return`, because the sample mean is what the
    model's return-target constraint uses. Holding the verifier to the
    generator's intended mean instead would report a shortfall wherever the
    draw happened to land below it and call the solver wrong for it.

    Args:
        universe: Borrow fees, half-spreads and the starting book.
        returns: The `[S, N]` matrix the book was chosen on.
        weights: Signed fractions of NAV, one per name.

    Returns:
        Gross return, borrow cost, trading cost and the net of the three.
    """
    short_notional = np.maximum(-weights, 0.0)
    traded_notional = np.abs(weights - universe.start_book)
    gross = float(returns.mean(axis=0) @ weights)
    borrow = float((universe.borrow_fee_annual / MONTHS_PER_YEAR) @ short_notional)
    trading = float(universe.half_spread @ traded_notional)
    return CostLedger(
        expected_gross_return=gross,
        borrow_cost=borrow,
        trading_cost=trading,
        expected_net_return=gross - borrow - trading,
    )


def var_interval(losses: FloatArray, beta: float) -> tuple[float, float]:
    """Return the closed interval of value-at-risk levels the optimum allows.

    Hold the optimal weights fixed and read the Rockafellar-Uryasev
    objective as a function of the auxiliary scalar `a` alone:

        g(a) = a + mean over the tail denominator of max(L_s - a, 0)

    Its derivative is `1 - #{s : L_s > a} / ((1 - beta) * S)`. Strictly
    between the `(k+1)`-th and `k`-th largest losses that count is exactly
    `k`, so with `(1 - beta) * S` equal to `k` the derivative is zero and
    **every point of `[L_(k+1), L_(k)]` minimizes it**. The optimum in `a`
    is a segment, not a point, and a solver may return anywhere on it: an
    interior-point method tends toward the middle, a simplex method lands
    on an end.

    So `a == var` is not a theorem, and asserting it would fail on a
    perfectly correct solve of a scenario that happens not to be
    degenerate. What the reformulation guarantees is containment in this
    interval, and that is what `verification.py` tests. The shipped
    scenario collapses the interval to a width of about 4e-12, because
    seventeen of its scenarios sit exactly on the threshold — a property of
    that mandate and that matrix, not of the method, and one a reader can
    remove by editing either.

    Args:
        losses: The loss vector of the solved book.
        beta: The confidence level the tail was taken at.

    Returns:
        `(L_(k+1), L_(k))`, the lower and upper ends of the optimal set.
        When the tail is the whole sample there is no `(k+1)`-th loss and
        the lower end is minus infinity, which is the correct answer: any
        `a` at or below the smallest loss is optimal there.
    """
    count = losses.shape[0]
    in_tail = tail_count(count, beta)
    ordered = np.sort(losses)
    upper = float(ordered[count - in_tail])
    below = count - in_tail - 1
    lower = float(ordered[below]) if below >= 0 else float("-inf")
    return lower, upper


def interval_distance(value: float, interval: tuple[float, float]) -> float:
    """Return how far `value` sits outside `interval`, or zero if inside."""
    lower, upper = interval
    return max(0.0, lower - value, value - upper)


def threshold_count(losses: FloatArray, beta: float, *, tolerance: float) -> int:
    """Count the scenarios whose loss sits on the value-at-risk threshold.

    This is a reported number and never an assertion. It is worth printing
    because it explains the interval above: the more scenarios pile up on
    the threshold, the narrower the set of optimal `a` becomes, and it is
    also why the tail average has a vertex to be optimal at in the first
    place. On the shipped mandate it comes out at seventeen of six hundred.
    """
    _, threshold = var_interval(losses, beta)
    return int(np.count_nonzero(np.abs(losses - threshold) <= tolerance))
