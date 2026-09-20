"""The re-solve that checks a shadow price, and the comparison that judges it.

A dual is a claim about a derivative: move this bound by one unit and the
optimal tail loss moves by *this* much. The claim is checkable the obvious
way — move the bound a little in both directions, re-solve, and take a
central difference. That is what this module does, and it is the only part
of the lab that deliberately solves a program nobody asked for.

Two bounds behave differently under the nudge, and the difference is the
whole reason the return target is a `cp.Parameter`:

* `return_target`'s bound *is* the parameter, so both nudged solves reuse
  the compiled problem the caller already has.
* `gross_leverage`, `turnover_budget` and the two beta sides bake their
  bound into the constraint expression, so each nudge rebuilds the program
  from a `dataclasses.replace`d mandate. Two builds and two solves per
  active row of that kind.

**A nudge that cannot be solved is reported as such.** If the program comes
back `infeasible`, or merely `optimal_inaccurate`, the derivative it would
imply is not one worth printing, so the measurement is `None` and the
reader is told the price could not be checked here. The alternative —
dropping the row — would leave a table that silently answers a smaller
question than it appears to.
"""

from __future__ import annotations

import cvxpy as cp

from app.contracts import MarketScenarios, Scenario
from app.duals_constraints import (
    RETURN_TARGET_LABEL,
    ConstraintRow,
    nudge_step,
    with_limit,
)
from app.logging_setup import Logger
from app.model import BuiltProblem, build_cvar_problem
from app.solver import solve_problem

# The floor of the agreement test's scale, so two numbers that are both
# essentially zero are not held to a relative tolerance of nothing.
AGREEMENT_FLOOR = 1e-12


def _objective_at(
    scenario: Scenario,
    market: MarketScenarios,
    built: BuiltProblem,
    row: ConstraintRow,
    *,
    bound: float,
    target: float,
    algorithm: str,
    log: Logger,
) -> float | None:
    """Re-solve with one bound moved and return the optimal value, or `None`."""
    if row.label == RETURN_TARGET_LABEL:
        outcome = solve_problem(built, algorithm=algorithm, target=bound, log=log)
    else:
        rebuilt = build_cvar_problem(
            with_limit(scenario, row.label, bound), market, log=log
        )
        outcome = solve_problem(rebuilt, algorithm=algorithm, target=target, log=log)
    if outcome.status != cp.OPTIMAL or outcome.solution is None:
        return None
    return outcome.solution.objective


def finite_difference(
    scenario: Scenario,
    market: MarketScenarios,
    built: BuiltProblem,
    row: ConstraintRow,
    *,
    target: float,
    algorithm: str,
    log: Logger,
) -> float | None:
    """Measure `d(objective) / d(right_hand_side)` by two nudged re-solves.

    Args:
        scenario: The mandate to rebuild from, for the rows whose bound is
            baked into the constraint.
        market: The `[S, N]` matrix a rebuild needs.
        built: The compiled problem, used directly for `return_target`.
        row: The constraint to move, already measured on its own
            left-hand side.
        target: The return target the original book was solved at, held
            fixed while any other bound is moved.
        algorithm: The solver that produced the original book, so the
            comparison is not confounded by a change of method.
        log: Logger, passed to the builds and solves.

    Returns:
        The central difference, or `None` if either nudged program failed
        to solve to optimality.
    """
    step = nudge_step(row.right_hand_side)
    above = _objective_at(
        scenario,
        market,
        built,
        row,
        bound=row.right_hand_side + step,
        target=target,
        algorithm=algorithm,
        log=log,
    )
    below = _objective_at(
        scenario,
        market,
        built,
        row,
        bound=row.right_hand_side - step,
        target=target,
        algorithm=algorithm,
        log=log,
    )
    if above is None or below is None:
        return None
    return (above - below) / (2.0 * step)


def agrees(
    row: ConstraintRow, *, dual: float, measured: float, tolerance: float
) -> bool:
    """Does the measured slope match the one the reported dual predicts?

    CVXPY reports a nonnegative dual for a constraint of either sense: it
    is the rate at which the objective worsens as the bound tightens. The
    slope with respect to the *right-hand side* therefore carries the
    constraint's own sign, which `ConstraintRow.rhs_slope_sign` holds —
    positive for the two `>=` rows, negative for the three `<=` rows. That
    sign is the substance of the check rather than bookkeeping: a dual read
    off the wrong constraint, or a sense written backwards, shows up here
    as a slope of the right size and the wrong sign.

    The comparison is relative, against the larger of the two magnitudes,
    with a floor so that two numbers which are both essentially zero are
    not held to a tolerance of nothing.
    """
    predicted = row.rhs_slope_sign * dual
    scale = max(abs(predicted), abs(measured), AGREEMENT_FLOOR)
    return abs(measured - predicted) <= tolerance * scale
