"""The thirteen checks a solution has to pass, and what they compare with.

A check is a name, a verdict and a sentence justifying the verdict. The
sentence is written whether the check passes or fails, so a report that
succeeds still records what it compared and a report that fails can quote
the computed value and the permitted one in the same breath.

Every comparison carries an explicit tolerance, because every number being
compared came out of a floating-point solve. A book whose gross leverage
lands on 1.4000000000000001 against a cap of 1.4 is at the cap, not over
it, and a verifier that says otherwise is measuring the last bit of a
double rather than the portfolio.

Two of the comparisons are deliberately one-sided, because the mathematics
is one-sided. The mandate's limits use `at_most`. The return target uses
`at_least`, and the asymmetry there is the point: the model priced the book
with a short leg and a turnover leg that can only *overstate* its costs, so
a correct solution's honestly recomputed net return sits at or above the
target it was held to, never below.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

import numpy as np

from app.contracts import FloatArray, Scenario, TailStatistics, Tolerances
from app.verification_exposures import CostLedger, DeskExposures


@dataclass(frozen=True)
class Check:
    """One named verification result and the sentence that justifies it."""

    name: str
    passed: bool
    detail: str


def at_most(name: str, value: float, limit: float, tolerance: float) -> Check:
    """Check that `value` does not exceed `limit` beyond `tolerance`."""
    return Check(
        name=name,
        passed=value <= limit + tolerance,
        detail=(
            f"{value:.12g} against a limit of {limit:.12g} (tolerance {tolerance:g})"
        ),
    )


def at_least(name: str, value: float, floor: float, tolerance: float) -> Check:
    """Check that `value` does not fall below `floor` beyond `tolerance`."""
    return Check(
        name=name,
        passed=value >= floor - tolerance,
        detail=(
            f"{value:.12g} against a floor of {floor:.12g} (tolerance {tolerance:g})"
        ),
    )


def within_band(
    name: str, value: float, low: float, high: float, tolerance: float
) -> Check:
    """Check that `value` lies inside `[low, high]` to within `tolerance`."""
    return Check(
        name=name,
        passed=low - tolerance <= value <= high + tolerance,
        detail=(
            f"{value:.12g} against the band [{low:.12g}, {high:.12g}] "
            f"(tolerance {tolerance:g})"
        ),
    )


def close_to(name: str, value: float, expected: float, tolerance: float) -> Check:
    """Check that two independently computed numbers agree absolutely.

    Absolute rather than relative: everything compared through this is a
    monthly return or a tail loss, a few percent of NAV either way, so a
    relative tolerance would tighten without limit as a portfolio's tail
    approached zero — exactly the case where nothing is wrong.
    """
    difference = abs(value - expected)
    return Check(
        name=name,
        passed=difference <= tolerance,
        detail=(
            f"{value:.12g} against {expected:.12g}, differing by {difference:.3g} "
            f"(tolerance {tolerance:g})"
        ),
    )


def holds(name: str, *, passed: bool, detail: str) -> Check:
    """Record a verdict that is not a numeric comparison."""
    return Check(name=name, passed=passed, detail=detail)


def first_failure(checks: Iterable[Check]) -> Check | None:
    """Return the earliest failing check in report order, if there is one."""
    return next((check for check in checks if not check.passed), None)


def mandate_checks(
    exposures: DeskExposures, ledger: CostLedger, scenario: Scenario
) -> list[Check]:
    """Check the recomputed book against every limit the desk imposes."""
    limits = scenario.limits
    tolerance = scenario.tolerances.constraint_abs
    return [
        at_most(
            "gross_leverage_within_cap",
            exposures.gross_leverage,
            limits.gross_leverage_max,
            tolerance,
        ),
        within_band(
            "net_exposure_within_band",
            exposures.net_exposure,
            limits.net_exposure_min,
            limits.net_exposure_max,
            tolerance,
        ),
        within_band(
            "beta_within_band",
            exposures.portfolio_beta,
            limits.beta_min,
            limits.beta_max,
            tolerance,
        ),
        at_most(
            "name_gross_within_cap",
            exposures.name_gross_max,
            limits.name_gross_cap,
            tolerance,
        ),
        at_most(
            "sector_net_within_cap",
            float(np.abs(exposures.sector_net).max()),
            limits.sector_net_cap,
            tolerance,
        ),
        at_most(
            "sector_gross_within_cap",
            float(exposures.sector_gross.max()),
            limits.sector_gross_cap,
            tolerance,
        ),
        at_most(
            "turnover_within_budget",
            exposures.turnover,
            limits.turnover_max,
            tolerance,
        ),
        at_least(
            "return_target_met",
            ledger.expected_net_return,
            scenario.headline_target_monthly,
            tolerance,
        ),
    ]


def model_checks(
    *,
    overlap: float,
    objective: float,
    in_sample: TailStatistics,
    oracle_cvar: float,
    auxiliary: float,
    var_gap: float,
    weights: FloatArray,
    tolerances: Tolerances,
) -> list[Check]:
    """Check the tail computations against each other and against the split.

    Three independent routes reach the same tail average here: the linear
    program's own objective, CVXPY's `sum_largest` oracle solved separately,
    and the empirical mean of the worst `k` losses computed in NumPy from
    the weights. Nothing but a correct model makes all three agree.
    """
    return [
        at_most("relaxation_exact", overlap, 0.0, tolerances.relaxation_abs),
        close_to(
            "cvar_matches_model_objective",
            objective,
            in_sample.cvar,
            tolerances.cvar_agreement_abs,
        ),
        close_to(
            "cvar_matches_atom_oracle",
            oracle_cvar,
            in_sample.cvar,
            tolerances.cvar_agreement_abs,
        ),
        # Containment in the optimal segment rather than equality with its
        # upper end; `verification_exposures.var_interval` derives why.
        at_most(
            "var_recovered_from_auxiliary", var_gap, 0.0, tolerances.var_recovery_abs
        ),
        holds(
            "weights_finite",
            passed=bool(np.isfinite(weights).all()) and bool(np.isfinite(auxiliary)),
            detail=(
                f"{int(np.count_nonzero(~np.isfinite(weights)))} non-finite of "
                f"{weights.size} weights, auxiliary scalar {auxiliary:.12g}"
            ),
        ),
    ]
